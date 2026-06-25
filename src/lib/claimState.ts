import { type PublicClient } from 'viem'
import { getAddresses } from '../config/addresses'
import { readErc20Decimals } from './erc20'
import { readStreamState } from './streamState'
import { readPeriodState } from './periodState'
import { streamedAvailable } from './streamTerms'
import { MAX_UINT256 } from './streamRate'
import { type StoredDelegation } from './storage'

export type ClaimScope = 'stream' | 'subscription'

export interface ClaimFigures {
  scope: ClaimScope
  decimals: number
  /** Already claimed — total for a stream, this-period for a subscription. Raw wei. */
  claimed: bigint
  /** Claimable right now, raw wei. */
  claimable: bigint
  /** Cap — lifetime for a stream, per-period for a subscription. `null` if unbounded. */
  cap: bigint | null
  /** True when read from on-chain enforcer state; false when estimated from terms. */
  onChain: boolean
}

export function claimScopeOf(d: StoredDelegation): ClaimScope | null {
  return d.meta.scopeType === 'erc20Streaming' ? 'stream' : d.meta.scopeType === 'erc20SpendingLimit' ? 'subscription' : null
}

/**
 * Read a delegation's claimed / claimable / cap from the caveat enforcer. Handles
 * both accumulating streams and per-period subscriptions; a stream before its first
 * claim falls back to the accrual estimate from the signed terms. The `client` must
 * target the delegation's chain. Throws if the scope is unsupported or the
 * subscription's period caveat can't be located.
 */
export async function readClaimFor(client: PublicClient, delegation: StoredDelegation): Promise<ClaimFigures> {
  const scope = claimScopeOf(delegation)
  const m = delegation.meta
  if (!scope || !m.tokenAddress) throw new Error('Delegation is not claimable')

  const decimals = await readErc20Decimals(client, m.tokenAddress).catch(() => 6)
  const delegationManager = getAddresses(m.chainId).delegationManager
  const caveats = delegation.delegation.caveats

  if (scope === 'subscription') {
    const period = await readPeriodState(client, caveats, delegationManager, m.delegationHash)
    if (!period) throw new Error('Could not locate the period-transfer caveat')
    return { scope, decimals, claimed: period.claimedThisPeriod, claimable: period.available, cap: period.periodAmount, onChain: true }
  }

  const onchain = await readStreamState(client, caveats, delegationManager, m.delegationHash)
  const metaMax = m.maxAmount ? BigInt(m.maxAmount) : MAX_UINT256
  if (onchain?.initialized) {
    return {
      scope,
      decimals,
      claimed: onchain.spent,
      claimable: onchain.available,
      cap: onchain.maxAmount === MAX_UINT256 ? null : onchain.maxAmount,
      onChain: true,
    }
  }
  const estimate = streamedAvailable({
    amountPerSecondRaw: m.amountPerSecond ?? '0',
    initialAmountRaw: m.initialAmount ?? '0',
    maxAmountRaw: m.maxAmount ?? MAX_UINT256.toString(),
    startTime: m.startTime ?? 0,
    nowSeconds: Math.floor(Date.now() / 1000),
  })
  return { scope, decimals, claimed: 0n, claimable: estimate, cap: metaMax === MAX_UINT256 ? null : metaMax, onChain: false }
}
