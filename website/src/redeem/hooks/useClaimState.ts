import { useCallback, useEffect, useState } from 'react'
import { createPublicClient, http } from 'viem'
import { findChain, rpcUrl } from '../config/supported-chains'
import { readClaimFor, claimScopeOf, type ClaimScope } from '../lib/claimState'
import { type StoredDelegation } from '../lib/storage'

export interface ClaimView {
  loading: boolean
  error: string | null
  scope: ClaimScope | null
  decimals: number
  /** Already claimed — total for a stream, this-period for a subscription. Raw wei. */
  claimed: bigint
  /** Claimable right now, raw wei. */
  claimable: bigint
  /** Cap — lifetime for a stream, per-period for a subscription. `null` if unbounded. */
  cap: bigint | null
  /** True when read from on-chain enforcer state; false when estimated from terms. */
  onChain: boolean
  refresh: () => void
}

const IDLE: Omit<ClaimView, 'refresh'> = {
  loading: false,
  error: null,
  scope: null,
  decimals: 6,
  claimed: 0n,
  claimable: 0n,
  cap: null,
  onChain: false,
}

/**
 * Resolve a single delegation's claimed / claimable / cap figures from the caveat
 * enforcer (stream lifetime cap or subscription per-period cap).
 */
export function useClaimState(delegation: StoredDelegation | null): ClaimView {
  const [view, setView] = useState(IDLE)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  const scope = delegation ? claimScopeOf(delegation) : null
  const active = !!(delegation && scope && delegation.meta.tokenAddress)

  useEffect(() => {
    if (!active || !delegation) return
    const m = delegation.meta
    let cancelled = false
    ;(async () => {
      setView((v) => ({ ...v, loading: true, error: null, scope }))
      const chain = findChain(m.chainId)
      if (!chain) throw new Error(`Unsupported chain: ${m.chainId}`)
      const client = createPublicClient({ chain, transport: http(rpcUrl(m.chainId)) })
      const figures = await readClaimFor(client, delegation)
      if (!cancelled) setView({ loading: false, error: null, ...figures })
    })().catch((e) => {
      if (!cancelled) setView((v) => ({ ...v, loading: false, error: e instanceof Error ? e.message : 'Failed to read claim state' }))
    })
    return () => {
      cancelled = true
    }
  }, [delegation, nonce, active, scope])

  // Idle is derived (not an effect-driven reset) so clearing the selection doesn't
  // setState inside the effect.
  return active ? { ...view, refresh } : { ...IDLE, refresh }
}
