import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import {
  ANALYTICS_RPC_URL,
  OURGLASS_ENFORCERS,
  LOOKBACK_BLOCKS,
  SCAN_CHUNK_BLOCKS,
} from './config';

type ChargeKind = 'subscription' | 'stream';

/** One attributable charge (subscription) or claim (stream), normalized. */
export interface Charge {
  kind: ChargeKind;
  delegationHash: string;
  token: Address;
  /** The receiver (delegate / payee) that redeemed. */
  redeemer: Address;
  /** The funding side recorded by the enforcer. */
  sender: Address;
  /** Per-charge amount in the token's raw units. */
  amount: bigint;
  /** Unix seconds, from the event's own timestamp field. */
  timestamp: number;
  txHash: string;
}

const PERIOD_EVENT = parseAbiItem(
  'event TransferredInPeriod(address indexed sender, address indexed redeemer, bytes32 indexed delegationHash, address token, uint256 periodAmount, uint256 periodDuration, uint256 startDate, uint256 transferredInCurrentPeriod, uint256 transferTimestamp)',
);
const STREAM_EVENT = parseAbiItem(
  'event IncreasedSpentMap(address indexed sender, address indexed redeemer, bytes32 indexed delegationHash, address token, uint256 initialAmount, uint256 maxAmount, uint256 amountPerSecond, uint256 startTime, uint256 spent, uint256 lastUpdateTimestamp)',
);

const client = createPublicClient({ chain: mainnet, transport: http(ANALYTICS_RPC_URL) });

// Per-charge cumulative-counter rows, decoupled from viem's Log type so the delta
// logic below is plain and testable.
interface PeriodRow {
  delegationHash: string;
  token: Address;
  redeemer: Address;
  sender: Address;
  cumulative: bigint;
  periodDuration: bigint;
  startDate: bigint;
  ts: bigint;
  txHash: string;
}
interface StreamRow {
  delegationHash: string;
  token: Address;
  redeemer: Address;
  sender: Address;
  spent: bigint;
  ts: bigint;
  txHash: string;
}

/**
 * Run `fetch` across [fromBlock, toBlock] in windows. If a window is rejected
 * (provider range/result caps vary) the step is halved and retried, down to a
 * single block, so the scan degrades gracefully; it recovers toward the default
 * window after a success.
 */
async function paginate<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  let start = fromBlock;
  let step = SCAN_CHUNK_BLOCKS;
  while (start <= toBlock) {
    const end = start + step - 1n > toBlock ? toBlock : start + step - 1n;
    try {
      out.push(...(await fetch(start, end)));
      start = end + 1n;
      if (step < SCAN_CHUNK_BLOCKS) step = step * 2n > SCAN_CHUNK_BLOCKS ? SCAN_CHUNK_BLOCKS : step * 2n;
    } catch (err) {
      if (step <= 1n) throw err;
      step = step / 2n;
    }
  }
  return out;
}

/**
 * Subscription charge = the in-period delta of the cumulative counter, which
 * resets each period. Period boundaries come from (startDate, periodDuration, ts),
 * so a new period's first charge is counted in full rather than as a delta against
 * the prior period.
 */
function periodCharges(rows: PeriodRow[]): Charge[] {
  const byHash = new Map<string, PeriodRow[]>();
  for (const r of rows) (byHash.get(r.delegationHash) ?? byHash.set(r.delegationHash, []).get(r.delegationHash)!).push(r);
  const charges: Charge[] = [];
  for (const group of byHash.values()) {
    group.sort((a, b) => Number(a.ts - b.ts));
    let prevPeriod: bigint | null = null;
    let prevCumulative = 0n;
    for (const r of group) {
      const duration = r.periodDuration > 0n ? r.periodDuration : 1n;
      const period = (r.ts - r.startDate) / duration;
      const amount = prevPeriod !== null && period === prevPeriod ? r.cumulative - prevCumulative : r.cumulative;
      prevPeriod = period;
      prevCumulative = r.cumulative;
      charges.push({
        kind: 'subscription',
        delegationHash: r.delegationHash,
        token: r.token,
        redeemer: r.redeemer,
        sender: r.sender,
        amount: amount > 0n ? amount : 0n,
        timestamp: Number(r.ts),
        txHash: r.txHash,
      });
    }
  }
  return charges;
}

/** Stream claim = delta of lifetime-cumulative `spent` (monotonic, no reset). */
function streamCharges(rows: StreamRow[]): Charge[] {
  const byHash = new Map<string, StreamRow[]>();
  for (const r of rows) (byHash.get(r.delegationHash) ?? byHash.set(r.delegationHash, []).get(r.delegationHash)!).push(r);
  const charges: Charge[] = [];
  for (const group of byHash.values()) {
    group.sort((a, b) => Number(a.ts - b.ts));
    let prevSpent = 0n;
    for (const r of group) {
      const amount = r.spent - prevSpent;
      prevSpent = r.spent;
      charges.push({
        kind: 'stream',
        delegationHash: r.delegationHash,
        token: r.token,
        redeemer: r.redeemer,
        sender: r.sender,
        amount: amount > 0n ? amount : 0n,
        timestamp: Number(r.ts),
        txHash: r.txHash,
      });
    }
  }
  return charges;
}

/**
 * The latest on-chain state of a stream delegation — enough to compute its live
 * accruing-unclaimed balance (`min(max, initial + rate × elapsed) − spent`) and the
 * rate at which it keeps growing. Discarded by the per-charge delta logic above, so
 * surfaced separately for the live counter.
 */
export interface StreamPosition {
  delegationHash: string;
  token: Address;
  initialAmount: bigint;
  maxAmount: bigint;
  amountPerSecond: bigint;
  startTime: bigint;
  spent: bigint;
}

/**
 * Load all attributable charges + claims from the OurGlass enforcer instances, plus
 * the latest position of each stream (one log scan, no extra requests).
 */
export async function loadActivity(): Promise<{ charges: Charge[]; streamPositions: StreamPosition[] }> {
  const latest = await client.getBlockNumber();
  const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;

  const [periodLogs, streamLogs] = await Promise.all([
    paginate(fromBlock, latest, (from, to) =>
      client.getLogs({ address: OURGLASS_ENFORCERS.period, event: PERIOD_EVENT, fromBlock: from, toBlock: to }),
    ),
    paginate(fromBlock, latest, (from, to) =>
      client.getLogs({ address: OURGLASS_ENFORCERS.stream, event: STREAM_EVENT, fromBlock: from, toBlock: to }),
    ),
  ]);

  const periodRows: PeriodRow[] = periodLogs.map((l) => ({
    delegationHash: l.args.delegationHash!,
    token: l.args.token!,
    redeemer: l.args.redeemer!,
    sender: l.args.sender!,
    cumulative: l.args.transferredInCurrentPeriod!,
    periodDuration: l.args.periodDuration!,
    startDate: l.args.startDate!,
    ts: l.args.transferTimestamp!,
    txHash: l.transactionHash,
  }));
  const streamRows: StreamRow[] = streamLogs.map((l) => ({
    delegationHash: l.args.delegationHash!,
    token: l.args.token!,
    redeemer: l.args.redeemer!,
    sender: l.args.sender!,
    spent: l.args.spent!,
    ts: l.args.lastUpdateTimestamp!,
    txHash: l.transactionHash,
  }));

  // Keep the latest IncreasedSpentMap per delegation (by its own timestamp).
  const posTs = new Map<string, bigint>();
  const posByHash = new Map<string, StreamPosition>();
  for (const l of streamLogs) {
    const hash = l.args.delegationHash!;
    const ts = l.args.lastUpdateTimestamp!;
    if ((posTs.get(hash) ?? -1n) <= ts) {
      posTs.set(hash, ts);
      posByHash.set(hash, {
        delegationHash: hash,
        token: l.args.token!,
        initialAmount: l.args.initialAmount!,
        maxAmount: l.args.maxAmount!,
        amountPerSecond: l.args.amountPerSecond!,
        startTime: l.args.startTime!,
        spent: l.args.spent!,
      });
    }
  }

  const charges = [...periodCharges(periodRows), ...streamCharges(streamRows)].sort((a, b) => a.timestamp - b.timestamp);
  return { charges, streamPositions: [...posByHash.values()] };
}
