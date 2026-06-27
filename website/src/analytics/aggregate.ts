import type { Charge } from './events';
import { dayKey } from './format';

/** Headline figures across all charges. */
export interface Totals {
  charges: number;
  subscriptionCharges: number;
  streamClaims: number;
  agreements: number;
  receivers: number;
  tokens: number;
}

export function totals(charges: Charge[]): Totals {
  return {
    charges: charges.length,
    subscriptionCharges: charges.filter((c) => c.kind === 'subscription').length,
    streamClaims: charges.filter((c) => c.kind === 'stream').length,
    agreements: new Set(charges.map((c) => c.delegationHash)).size,
    receivers: new Set(charges.map((c) => c.redeemer.toLowerCase())).size,
    tokens: new Set(charges.map((c) => c.token.toLowerCase())).size,
  };
}

/** Volume + count per token (amounts are only summable within a token). */
export interface TokenVolume {
  token: string;
  total: bigint;
  count: number;
}

export function byToken(charges: Charge[]): TokenVolume[] {
  const map = new Map<string, TokenVolume>();
  for (const c of charges) {
    const key = c.token.toLowerCase();
    const row = map.get(key) ?? { token: key, total: 0n, count: 0 };
    row.total += c.amount;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Grouping with a per-token volume breakdown, ordered by charge count. */
export interface Group {
  key: string;
  count: number;
  volumeByToken: Map<string, bigint>;
}

function groupBy(charges: Charge[], keyOf: (c: Charge) => string): Group[] {
  const map = new Map<string, Group>();
  for (const c of charges) {
    const key = keyOf(c);
    const g = map.get(key) ?? { key, count: 0, volumeByToken: new Map() };
    g.count += 1;
    const t = c.token.toLowerCase();
    g.volumeByToken.set(t, (g.volumeByToken.get(t) ?? 0n) + c.amount);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function byReceiver(charges: Charge[]): Group[] {
  return groupBy(charges, (c) => c.redeemer.toLowerCase());
}

export function byAgreement(charges: Charge[]): Group[] {
  return groupBy(charges, (c) => c.delegationHash);
}

/** Charge count per UTC day, ascending, gap-free between first and last day. */
export interface DayBucket {
  day: string;
  count: number;
}

export function chargesPerDay(charges: Charge[]): DayBucket[] {
  if (charges.length === 0) return [];
  const counts = new Map<string, number>();
  for (const c of charges) {
    const d = dayKey(c.timestamp);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const days = [...counts.keys()].sort();
  const first = new Date(`${days[0]}T00:00:00Z`).getTime();
  const last = new Date(`${days[days.length - 1]}T00:00:00Z`).getTime();
  const out: DayBucket[] = [];
  for (let t = first; t <= last; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}
