/**
 * Read OurGlass activity from our own mainnet caveat enforcer events — auto-
 * discovered, no hash list to maintain. Free public RPCs block historical
 * `eth_getLogs`, so this uses the Etherscan API `getLogs` endpoint (free key),
 * filtered by our enforcer addresses (so every log is OurGlass-attributable).
 *
 *   streaming  IncreasedSpentMap   (ERC20StreamingEnforcer 0xE475…)
 *   period     TransferredInPeriod (ERC20PeriodTransferEnforcer 0x1126…)
 *
 * Set NEXT_PUBLIC_ETHERSCAN_KEY to a free Etherscan API key.
 */

const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_KEY = process.env.NEXT_PUBLIC_ETHERSCAN_KEY ?? '';
const CHAIN_ID = 1;

const STREAMING_ENFORCER = '0xE475D14d61756D6e940B74C20d2E44EB70c71a8D';
const PERIOD_ENFORCER = '0x11262E3116a50654547AB0A417BE77eB14b9F339';
const INCREASED_SPENT_TOPIC = '0x30ceca901166c86cac9d1024230d7f5740b26cce6bdd9bad7b1d6e616904ea63';
const TRANSFERRED_IN_PERIOD_TOPIC = '0xb2a345c7f80b4be490c405f4a994faf85384dd05da7d70be0801dc31a8c253af';
// USDC has 6 decimals; the headline is USDC-denominated.
const DECIMALS = 1_000_000;

interface EtherscanLog {
  topics: string[];
  data: string;
  blockNumber: string;
}

// Pull every matching log for an enforcer event via Etherscan. Returns [] when the
// contract has no events yet ("No records found").
async function getLogs(address: string, topic0: string, signal?: AbortSignal): Promise<EtherscanLog[]> {
  const url =
    `${ETHERSCAN_API}?chainid=${CHAIN_ID}&module=logs&action=getLogs` +
    `&address=${address}&topic0=${topic0}&fromBlock=0&toBlock=latest&page=1&offset=1000&apikey=${ETHERSCAN_KEY}`;
  const res = await fetch(url, { signal });
  const json = (await res.json()) as { status: string; message: string; result: EtherscanLog[] | string };
  if (json.status === '1' && Array.isArray(json.result)) return json.result;
  if (json.status === '0' && (json.message === 'No records found' || (Array.isArray(json.result) && json.result.length === 0))) return [];
  throw new Error(typeof json.result === 'string' ? json.result : json.message || 'Etherscan getLogs failed');
}

// The i-th 32-byte word of an ABI-encoded `data` payload, as a bigint.
const word = (data: string, i: number): bigint => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
const toNum = (raw: bigint): number => Number(raw) / DECIMALS;

export interface OnchainStats {
  /** Total value claimed through OurGlass, USDC. */
  settled: number;
  /** Accrued-but-unclaimed across active streams right now, USDC (the live base). */
  streamingBase: number;
  /** Combined accrual rate of the still-running streams, USDC/second. */
  streamingRate: number;
  /** Distinct delegations that have transacted. */
  delegations: number;
}

export async function fetchOnchainStats(signal?: AbortSignal): Promise<OnchainStats> {
  const [streamLogs, periodLogs] = await Promise.all([
    getLogs(STREAMING_ENFORCER, INCREASED_SPENT_TOPIC, signal),
    getLogs(PERIOD_ENFORCER, TRANSFERRED_IN_PERIOD_TOPIC, signal),
  ]);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const hashes = new Set<string>();

  // Streaming: keep the latest event per delegation (logs are ascending), then
  // derive claimed (spent) + the live accruing-unclaimed amount and its rate.
  // data words: token, initialAmount, maxAmount, amountPerSecond, startTime, spent, lastUpdate
  const streams = new Map<string, { initial: bigint; max: bigint; rate: bigint; start: bigint; spent: bigint }>();
  for (const log of streamLogs) {
    hashes.add(log.topics[3]);
    streams.set(log.topics[3], {
      initial: word(log.data, 1),
      max: word(log.data, 2),
      rate: word(log.data, 3),
      start: word(log.data, 4),
      spent: word(log.data, 5),
    });
  }

  let settled = 0;
  let streamingBase = 0;
  let streamingRate = 0;
  for (const s of streams.values()) {
    settled += toNum(s.spent);
    const elapsed = nowSec > s.start ? nowSec - s.start : 0n;
    let accrued = s.initial + s.rate * elapsed;
    if (accrued > s.max) accrued = s.max;
    const unclaimed = accrued > s.spent ? accrued - s.spent : 0n;
    streamingBase += toNum(unclaimed);
    if (accrued < s.max) streamingRate += toNum(s.rate);
  }

  // Period subscriptions: latest transferred-this-period per delegation contributes
  // to settled. data words: token, periodAmount, periodDuration, startDate, transferred, ts
  const periods = new Map<string, bigint>();
  for (const log of periodLogs) {
    hashes.add(log.topics[3]);
    periods.set(log.topics[3], word(log.data, 4));
  }
  for (const transferred of periods.values()) settled += toNum(transferred);

  return { settled, streamingBase, streamingRate, delegations: hashes.size };
}
