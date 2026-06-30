import { formatUnits } from 'viem';
import type { Charge, StreamPosition } from './events';
import type { TokenMeta } from './tokens';

export interface LiveStatsFigures {
  /** Total value ever settled through OurGlass, in display units (USDC-denominated). */
  settled: number;
  /** Accrued-but-unclaimed across active streams right now, display units. */
  streamingBase: number;
  /** Combined accrual rate of the still-running streams, display units per second. */
  streamingRate: number;
}

/**
 * The two headline figures for the live chrono, derived from the analytics data.
 * Amounts are summed in display units across tokens (the dashboard is
 * USDC-centric); unknown decimals default to 18.
 */
export function liveStats(charges: Charge[], streamPositions: StreamPosition[], tokens: Map<string, TokenMeta>): LiveStatsFigures {
  const decimalsOf = (token: string) => tokens.get(token.toLowerCase())?.decimals ?? 18;

  let settled = 0;
  for (const c of charges) settled += Number(formatUnits(c.amount, decimalsOf(c.token)));

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  let streamingBase = 0;
  let streamingRate = 0;
  for (const p of streamPositions) {
    const d = decimalsOf(p.token);
    const elapsed = nowSec > p.startTime ? nowSec - p.startTime : 0n;
    let accrued = p.initialAmount + p.amountPerSecond * elapsed;
    if (accrued > p.maxAmount) accrued = p.maxAmount;
    const unclaimed = accrued > p.spent ? accrued - p.spent : 0n;
    streamingBase += Number(formatUnits(unclaimed, d));
    // A stream that has reached its cap no longer accrues.
    if (accrued < p.maxAmount) streamingRate += Number(formatUnits(p.amountPerSecond, d));
  }

  return { settled, streamingBase, streamingRate };
}
