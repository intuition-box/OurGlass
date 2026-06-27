import { formatUnits } from 'viem';

/** Short 0x… address/hash for dense tables. */
export function shortHex(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** Token amount with thousands separators, at most `maxFractionDigits` decimals. */
export function formatAmount(raw: bigint, decimals: number, maxFractionDigits = 2): string {
  const n = Number(formatUnits(raw, decimals));
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });
}

/** Compact integer (e.g. 1,234). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** UTC day key (YYYY-MM-DD) for a unix-seconds timestamp. */
export function dayKey(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}
