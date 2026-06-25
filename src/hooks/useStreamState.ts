import { useCallback, useEffect, useState } from 'react'
import { createPublicClient, http } from 'viem'
import { findChain } from '../config/supported-chains'
import { getAddresses } from '../config/addresses'
import { readErc20Decimals } from '../lib/erc20'
import { readStreamState } from '../lib/streamState'
import { streamedAvailable } from '../lib/streamTerms'
import { MAX_UINT256 } from '../lib/streamRate'
import { type StoredDelegation } from '../lib/storage'

export interface StreamClaimView {
  loading: boolean
  error: string | null
  decimals: number
  /** Already claimed, raw wei. */
  claimed: bigint
  /** Claimable right now, raw wei. */
  claimable: bigint
  /** Lifetime cap, raw wei; `null` for an unbounded (rate-limited) stream. */
  cap: bigint | null
  /** True once read from on-chain enforcer state; false when estimated from terms. */
  onChain: boolean
  refresh: () => void
}

const IDLE: Omit<StreamClaimView, 'refresh'> = {
  loading: false,
  error: null,
  decimals: 6,
  claimed: 0n,
  claimable: 0n,
  cap: null,
  onChain: false,
}

/**
 * Resolve a stream's claimed / claimable / cap figures. Prefers on-chain enforcer
 * state once the stream has been charged; falls back to the accrual estimate from
 * the signed terms before the first claim.
 */
export function useStreamState(delegation: StoredDelegation | null): StreamClaimView {
  const [view, setView] = useState(IDLE)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!delegation || delegation.meta.scopeType !== 'erc20Streaming' || !delegation.meta.tokenAddress) {
      setView(IDLE)
      return
    }
    const m = delegation.meta
    const tokenAddress = m.tokenAddress
    if (!tokenAddress) return
    let cancelled = false
    setView((v) => ({ ...v, loading: true, error: null }))
    ;(async () => {
      const chain = findChain(m.chainId)
      if (!chain) throw new Error(`Unsupported chain: ${m.chainId}`)
      const client = createPublicClient({ chain, transport: http() })
      const decimals = await readErc20Decimals(client, tokenAddress).catch(() => 6)
      const delegationManager = getAddresses(m.chainId).delegationManager
      const onchain = await readStreamState(client, delegation.delegation.caveats, delegationManager, m.delegationHash)
      const metaMax = m.maxAmount ? BigInt(m.maxAmount) : MAX_UINT256

      let next: Omit<StreamClaimView, 'refresh'>
      if (onchain?.initialized) {
        next = {
          loading: false,
          error: null,
          decimals,
          claimed: onchain.spent,
          claimable: onchain.available,
          cap: onchain.maxAmount === MAX_UINT256 ? null : onchain.maxAmount,
          onChain: true,
        }
      } else {
        const estimate = streamedAvailable({
          amountPerSecondRaw: m.amountPerSecond ?? '0',
          initialAmountRaw: m.initialAmount ?? '0',
          maxAmountRaw: m.maxAmount ?? MAX_UINT256.toString(),
          startTime: m.startTime ?? 0,
          nowSeconds: Math.floor(Date.now() / 1000),
        })
        next = {
          loading: false,
          error: null,
          decimals,
          claimed: 0n,
          claimable: estimate,
          cap: metaMax === MAX_UINT256 ? null : metaMax,
          onChain: false,
        }
      }
      if (!cancelled) setView(next)
    })().catch((e) => {
      if (!cancelled) setView((v) => ({ ...v, loading: false, error: e instanceof Error ? e.message : 'Failed to read stream state' }))
    })
    return () => {
      cancelled = true
    }
  }, [delegation, nonce])

  return { ...view, refresh }
}
