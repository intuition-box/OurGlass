export type PeriodType = 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly'

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
    case 'monthly':
      return 2592000n // 30 days
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
    case 'monthly':
      return 'per month'
  }
}
