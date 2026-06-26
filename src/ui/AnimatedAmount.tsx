import { useEffect, useRef, useState } from 'react'
import { formatUnits } from 'viem'
import NumberFlow from '@number-flow/react'

/**
 * A live-counting amount rendered with NumberFlow (rolling-digit animation). Starts
 * at `base` and grows by `ratePerSecondRaw` (raw wei/second) in real time, clamped at
 * `max` if set. Reports the current raw value through `onValue` so the parent can
 * redeem exactly what is shown. With a zero rate (e.g. a subscription) it renders a
 * static figure.
 */
export function AnimatedAmount({
  base,
  ratePerSecondRaw,
  decimals,
  max = null,
  onValue,
}: {
  base: bigint
  ratePerSecondRaw: bigint
  decimals: number
  max?: bigint | null
  onValue?: (raw: bigint) => void
}) {
  const [value, setValue] = useState(() => Number(formatUnits(base, decimals)))
  const onValueRef = useRef(onValue)
  onValueRef.current = onValue

  // Streams tick the 6th decimal; static figures (subscriptions) show 2.
  const places = ratePerSecondRaw > 0n ? 6 : 2

  useEffect(() => {
    const emit = (raw: bigint) => {
      onValueRef.current?.(raw)
      setValue(Number(formatUnits(raw, decimals)))
    }
    if (ratePerSecondRaw <= 0n) {
      emit(base)
      return
    }
    // Tick once per second; NumberFlow animates the roll between values.
    const t0 = Date.now()
    const tick = () => {
      let cur = base + ratePerSecondRaw * BigInt(Math.floor((Date.now() - t0) / 1000))
      if (max != null && cur > max) cur = max
      emit(cur)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [base, ratePerSecondRaw, max, decimals])

  return (
    <NumberFlow
      value={value}
      format={{ minimumFractionDigits: places, maximumFractionDigits: places }}
      className="font-mono font-bold text-ink tnum tabular-nums"
    />
  )
}
