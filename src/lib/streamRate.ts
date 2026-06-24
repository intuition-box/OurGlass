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

export const RATE_UNITS: readonly RateUnit[] = [
  { key: 'second', label: 'Second', seconds: 1 },
  { key: 'minute', label: 'Minute', seconds: 60 },
  { key: 'hour', label: 'Hour', seconds: 3600 },
  { key: 'day', label: 'Day', seconds: 86400 },
  { key: 'week', label: 'Week', seconds: 604800 },
  { key: 'month', label: 'Month', seconds: 2592000 },
]

export function unitSeconds(key: RateUnitKey): number {
  const u = RATE_UNITS.find((x) => x.key === key)
  if (!u) throw new Error(`Unknown rate unit: ${key}`)
  return u.seconds
}

/** Per-second accrual (raw wei) from a human rate over a unit. Integer division — never over-pays. */
export function rateToPerSecond(amount: string, unit: RateUnitKey, decimals: number): bigint {
  return parseUnits(amount, decimals) / BigInt(unitSeconds(unit))
}

/** Trim a number to a sane precision for a rate input field (drops trailing zeros). */
function formatRateNumber(n: number): string {
  if (n === 0) return '0'
  const fixed = n >= 1 ? n.toFixed(2) : n.toPrecision(4)
  return String(parseFloat(fixed))
}

/**
 * Re-express the same flow at a different unit scale — used when the user changes
 * the time unit so the displayed amount stays equivalent (same per-second flow).
 * Pure display math; the on-chain truth stays `amountPerSecond`.
 */
export function convertRate(amount: string, fromUnit: RateUnitKey, toUnit: RateUnitKey): string {
  const n = parseFloat(amount)
  if (!Number.isFinite(n)) return amount
  return formatRateNumber((n * unitSeconds(toUnit)) / unitSeconds(fromUnit))
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
