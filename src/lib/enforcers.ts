export type PeriodType = 'minutely' | 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

const PERIOD_TYPES: PeriodType[] = ['minutely', 'hourly', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly']

export function isPeriodType(value: unknown): value is PeriodType {
  return typeof value === 'string' && (PERIOD_TYPES as string[]).includes(value)
}

export function periodToSeconds(period: PeriodType): bigint {
  switch (period) {
    case 'minutely':
      return 60n
    case 'hourly':
      return 3600n
    case 'daily':
      return 86400n
    case 'weekly':
      return 604800n
    case 'biweekly':
      return 1209600n // 14 days
    case 'monthly':
      return 2592000n // 30 days
    case 'yearly':
      return 31104000n // 12 × 30 days (keeps monthly × 12 exact)
  }
}

export function periodLabel(period: PeriodType): string {
  switch (period) {
    case 'minutely':
      return 'per minute'
    case 'hourly':
      return 'per hour'
    case 'daily':
      return 'per day'
    case 'weekly':
      return 'per week'
    case 'biweekly':
      return 'per 2 weeks'
    case 'monthly':
      return 'per month'
    case 'yearly':
      return 'per year'
  }
}

/** The bare period noun, e.g. "month" — for "300 USDC / month" style copy. */
export function periodNoun(period: PeriodType): string {
  switch (period) {
    case 'minutely':
      return 'minute'
    case 'hourly':
      return 'hour'
    case 'daily':
      return 'day'
    case 'weekly':
      return 'week'
    case 'biweekly':
      return '2 weeks'
    case 'monthly':
      return 'month'
    case 'yearly':
      return 'year'
  }
}
