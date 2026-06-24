import { parseUnits, formatUnits } from 'viem'

/**
 * Stream rate math. A stream's only real constraint is its per-second flow
 * (`amountPerSecond`); "per minute / day / month" are just display scales of the
 * same flow. This module is the single source of truth for converting between a
 * human rate at a chosen scale and the on-chain per-second amount, and for the
 * two ways to bound a stream — a total budget or an end date — which both reduce
 * to the enforcer's `maxAmount`.
 */

/** Unbounded total: the stream runs at its rate until revoked. */
export const MAX_UINT256 = 2n ** 256n - 1n

export interface RateUnit {
  key: RateUnitKey
  label: string
  seconds: number
}

export type RateUnitKey = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month'

// Ordered most-used-first so "month" — the default and the scale people actually
// think in for payroll — sits at the top of the unit dropdown.
export const RATE_UNITS: readonly RateUnit[] = [
  { key: 'month', label: 'Month', seconds: 2592000 },
  { key: 'week', label: 'Week', seconds: 604800 },
  { key: 'day', label: 'Day', seconds: 86400 },
  { key: 'hour', label: 'Hour', seconds: 3600 },
  { key: 'minute', label: 'Minute', seconds: 60 },
  { key: 'second', label: 'Second', seconds: 1 },
]

export function unitSeconds(key: RateUnitKey): number {
  const u = RATE_UNITS.find((x) => x.key === key)
  if (!u) throw new Error(`Unknown rate unit: ${key}`)
  return u.seconds
}

/**
 * Per-second accrual (raw wei) from a human rate over a unit. Rounds UP (ceil) to
 * the next whole wei/second so the flow is never BELOW the intended rate: the
 * beneficiary is never shorted (and they pay the gas to claim, so a shortfall
 * would be doubly unfair). Paired with maxAmount = the exact total, the cap still
 * holds the total exactly — ceil just makes the stream reach the cap a hair early
 * instead of late. Granularity is one wei/second (≈ 2.6 USDC/month for 6-decimal
 * tokens, so very small USDC rates overshoot noticeably; negligible for 18).
 */
export function rateToPerSecond(amount: string, unit: RateUnitKey, decimals: number): bigint {
  const total = parseUnits(amount, decimals)
  const secs = BigInt(unitSeconds(unit))
  return (total + secs - 1n) / secs
}

/**
 * The exact human rate an integer per-second flow represents at a unit scale —
 * the "snapped" value to show so the UI never displays an amount the caveat can't
 * actually stream (for USDC 300/month snaps to 300.672; for 18-decimal tokens the
 * snap is invisible).
 */
export function perSecondToRate(amountPerSecondRaw: bigint, unit: RateUnitKey, decimals: number): string {
  return formatUnits(amountPerSecondRaw * BigInt(unitSeconds(unit)), decimals)
}

/** The same per-second flow expressed at every scale, for a reactive breakdown line. */
export function rateBreakdown(amountPerSecondRaw: bigint, decimals: number): Record<RateUnitKey, string> {
  const out = {} as Record<RateUnitKey, string>
  for (const u of RATE_UNITS) out[u.key] = formatUnits(amountPerSecondRaw * BigInt(u.seconds), decimals)
  return out
}

/** Seconds until a capped budget is exhausted at the given flow (after the upfront amount). */
export function secondsToBudget(amountPerSecondRaw: bigint, maxRaw: bigint, initialRaw: bigint): number {
  if (amountPerSecondRaw <= 0n) return 0
  const streamed = maxRaw > initialRaw ? maxRaw - initialRaw : 0n
  return Number(streamed / amountPerSecondRaw)
}

/** Total budget (raw) a flow reaches by an end timestamp — the end-date path to maxAmount. */
export function budgetByEndTime(amountPerSecondRaw: bigint, startTime: number, endTime: number, initialRaw: bigint): bigint {
  if (endTime <= startTime) return initialRaw
  return initialRaw + amountPerSecondRaw * BigInt(endTime - startTime)
}

/** Compact human duration from seconds, e.g. "3 months", "12 days". */
export function humanDuration(seconds: number): string {
  if (seconds <= 0) return 'instantly'
  const units: [number, string][] = [
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ]
  for (const [s, name] of units) {
    if (seconds >= s) {
      const v = Math.round(seconds / s)
      return `${v} ${name}${v === 1 ? '' : 's'}`
    }
  }
  return `${seconds} seconds`
}
