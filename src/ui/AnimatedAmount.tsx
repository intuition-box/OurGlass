import { useEffect, useRef, useState } from 'react'
import { formatUnits } from 'viem'

// Fixed-decimals formatter so the trailing digits tick visibly (no trim).
function fixed(raw: bigint, decimals: number, places: number): string {
  const [int, frac = ''] = formatUnits(raw, decimals).split('.')
  return `${int}.${(frac + '0'.repeat(places)).slice(0, places)}`
}

/**
 * A live-counting amount: starts at `base` and grows by `ratePerSecondRaw` (raw
 * wei/second) in real time, clamped at `max` if set. Reports the current raw value
 * through `onValue` so the parent can redeem exactly what is shown. With a zero
 * rate (e.g. a subscription) it renders a static figure.
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
  const [value, setValue] = useState(base)
  const onValueRef = useRef(onValue)
  onValueRef.current = onValue

  const places = ratePerSecondRaw > 0n ? 6 : 2

  useEffect(() => {
    const emit = (raw: bigint) => {
      setValue(raw)
      onValueRef.current?.(raw)
    }
    if (ratePerSecondRaw <= 0n) {
      emit(base)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      const elapsedMs = Math.floor(performance.now() - t0)
      let cur = base + (ratePerSecondRaw * BigInt(elapsedMs)) / 1000n
      if (max != null && cur > max) cur = max
      emit(cur)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [base, ratePerSecondRaw, max])

  return <span className="font-mono font-bold text-ink tnum tabular-nums">{fixed(value, decimals, places)}</span>
}
