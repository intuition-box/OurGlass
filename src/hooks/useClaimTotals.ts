import { useCallback, useEffect, useState } from 'react'
import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { findChain, rpcUrl } from '../config/supported-chains'
import { readClaimFor } from '../lib/claimState'
import { type StoredDelegation } from '../lib/storage'

export interface TokenTotal {
  tokenAddress: Address
  decimals: number
  /** Summed claimable-now across the delegations of this token, raw wei. */
  claimable: bigint
  /** Summed already-claimed across the delegations of this token, raw wei. */
  claimed: bigint
}

export interface ClaimTotals {
  loading: boolean
  error: string | null
  groups: TokenTotal[]
  /** Number of active streams whose state resolved. */
  streams: number
  /** Number of active subscriptions whose state resolved. */
  subscriptions: number
  refresh: () => void
}

const IDLE: Omit<ClaimTotals, 'refresh'> = { loading: false, error: null, groups: [], streams: 0, subscriptions: 0 }

/**
 * Aggregate claimed / claimable across a set of delegations, grouped by token
 * (decimals differ per token, so amounts are only summed within a token). Reads
 * each delegation's enforcer state on its own chain, reusing one client per chain.
 */
export function useClaimTotals(delegations: StoredDelegation[]): ClaimTotals {
  const [totals, setTotals] = useState(IDLE)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Re-run when the set of delegations changes (by hash) or on explicit refresh.
  const key = delegations.map((d) => d.meta.delegationHash).join(',')

  useEffect(() => {
    if (delegations.length === 0) return
    let cancelled = false
    ;(async () => {
      setTotals((t) => ({ ...t, loading: true, error: null }))
      const clients = new Map<number, PublicClient>()
      const clientFor = (chainId: number): PublicClient | null => {
        const cached = clients.get(chainId)
        if (cached) return cached
        const chain = findChain(chainId)
        if (!chain) return null
        const client = createPublicClient({ chain, transport: http(rpcUrl(chainId)) })
        clients.set(chainId, client)
        return client
      }

      const results = await Promise.all(
        delegations.map(async (d) => {
          const client = clientFor(d.meta.chainId)
          if (!client || !d.meta.tokenAddress) return null
          try {
            const figures = await readClaimFor(client, d)
            return { tokenAddress: d.meta.tokenAddress, figures }
          } catch {
            return null
          }
        }),
      )

      const byToken = new Map<string, TokenTotal>()
      let streams = 0
      let subscriptions = 0
      for (const r of results) {
        if (!r) continue
        if (r.figures.scope === 'stream') streams += 1
        else subscriptions += 1
        const tokenKey = r.tokenAddress.toLowerCase()
        const group = byToken.get(tokenKey) ?? { tokenAddress: r.tokenAddress, decimals: r.figures.decimals, claimable: 0n, claimed: 0n }
        group.claimable += r.figures.claimable
        group.claimed += r.figures.claimed
        byToken.set(tokenKey, group)
      }

      if (!cancelled) setTotals({ loading: false, error: null, groups: [...byToken.values()], streams, subscriptions })
    })().catch((e) => {
      if (!cancelled) setTotals((t) => ({ ...t, loading: false, error: e instanceof Error ? e.message : 'Failed to read totals' }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  // Idle is derived (not an effect-driven reset) so an empty set doesn't setState
  // inside the effect.
  return delegations.length === 0 ? { ...IDLE, refresh } : { ...totals, refresh }
}
