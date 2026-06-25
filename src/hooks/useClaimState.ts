import { useCallback, useEffect, useState } from 'react'
import { createPublicClient, http } from 'viem'
import { findChain } from '../config/supported-chains'
import { getAddresses } from '../config/addresses'
import { readErc20Decimals } from '../lib/erc20'
import { readStreamState } from '../lib/streamState'
import { readPeriodState } from '../lib/periodState'
import { streamedAvailable } from '../lib/streamTerms'
import { MAX_UINT256 } from '../lib/streamRate'
import { type StoredDelegation } from '../lib/storage'

export type ClaimScope = 'stream' | 'subscription'

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

const scopeOf = (d: StoredDelegation): ClaimScope | null =>
  d.meta.scopeType === 'erc20Streaming' ? 'stream' : d.meta.scopeType === 'erc20SpendingLimit' ? 'subscription' : null

/**
 * Resolve a delegation's claimed / claimable / cap figures from the caveat
 * enforcer. Handles both accumulating streams (erc20Streaming) and per-period
 * subscriptions (erc20PeriodTransfer); a stream before its first claim falls back
 * to the accrual estimate from the signed terms.
 */
export function useClaimState(delegation: StoredDelegation | null): ClaimView {
  const [view, setView] = useState(IDLE)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const scope = delegation ? scopeOf(delegation) : null
    if (!delegation || !scope || !delegation.meta.tokenAddress) {
      setView(IDLE)
      return
    }
    const m = delegation.meta
    const tokenAddress = m.tokenAddress
    if (!tokenAddress) return
    let cancelled = false
    setView((v) => ({ ...v, loading: true, error: null, scope }))
    ;(async () => {
      const chain = findChain(m.chainId)
      if (!chain) throw new Error(`Unsupported chain: ${m.chainId}`)
      const client = createPublicClient({ chain, transport: http() })
      const decimals = await readErc20Decimals(client, tokenAddress).catch(() => 6)
      const delegationManager = getAddresses(m.chainId).delegationManager
      const caveats = delegation.delegation.caveats

      let next: Omit<ClaimView, 'refresh'>
      if (scope === 'subscription') {
        const period = await readPeriodState(client, caveats, delegationManager, m.delegationHash)
        if (!period) throw new Error('Could not locate the period-transfer caveat')
        next = {
          loading: false,
          error: null,
          scope,
          decimals,
          claimed: period.claimedThisPeriod,
          claimable: period.available,
          cap: period.periodAmount,
          onChain: true,
        }
      } else {
        const onchain = await readStreamState(client, caveats, delegationManager, m.delegationHash)
        const metaMax = m.maxAmount ? BigInt(m.maxAmount) : MAX_UINT256
        if (onchain?.initialized) {
          next = {
            loading: false,
            error: null,
            scope,
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
            scope,
            decimals,
            claimed: 0n,
            claimable: estimate,
            cap: metaMax === MAX_UINT256 ? null : metaMax,
            onChain: false,
          }
        }
      }
      if (!cancelled) setView(next)
    })().catch((e) => {
      if (!cancelled) setView((v) => ({ ...v, loading: false, error: e instanceof Error ? e.message : 'Failed to read claim state' }))
    })
    return () => {
      cancelled = true
    }
  }, [delegation, nonce])

  return { ...view, refresh }
}
