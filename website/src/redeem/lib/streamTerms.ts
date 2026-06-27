/**
 * Linearly-accrued balance unlocked by an `erc20Streaming` caveat at `nowSeconds`:
 *   available(t) = min(maxAmount, initialAmount + amountPerSecond * (t - startTime))
 */
export function streamedAvailable(params: {
  amountPerSecondRaw: string
  initialAmountRaw: string
  maxAmountRaw: string
  startTime: number
  nowSeconds: number
}): bigint {
  const { amountPerSecondRaw, initialAmountRaw, maxAmountRaw, startTime, nowSeconds } = params
  // Before startTime the enforcer unlocks nothing — not even the upfront (matches
  // ERC20StreamingEnforcer: `block.timestamp < startTime` returns 0).
  if (nowSeconds < startTime) return 0n
  const elapsed = BigInt(nowSeconds - startTime)
  const accrued = BigInt(initialAmountRaw) + BigInt(amountPerSecondRaw) * elapsed
  const max = BigInt(maxAmountRaw)
  return accrued > max ? max : accrued
}
