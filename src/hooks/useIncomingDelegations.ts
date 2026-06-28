import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { discoverIncomingDelegations } from '../lib/intuition/discover'
import { isDelegationEnabled } from '../lib/intuition/enabled'
import type { StoredDelegation } from '../lib/storage'

/**
 * Active delegations made TO an account, discovered on Intuition and cross-checked
 * enabled on the origin-chain DelegationManager. Drives the Safe App charge list
 * (manual import stays as a fallback).
 */
export function useIncomingDelegations(
  address: Address | undefined,
  chainId: number | undefined,
): {
  delegations: StoredDelegation[]
  loading: boolean
  error: unknown
  refetch: () => void
} {
  const query = useQuery({
    queryKey: ['incoming-delegations', address, chainId],
    enabled: Boolean(address && chainId),
    queryFn: async (): Promise<StoredDelegation[]> => {
      const discovered = await discoverIncomingDelegations(address!, chainId!)
      const checked = await Promise.all(
        discovered.map(async (d) => ({ d, enabled: await safeEnabled(d) })),
      )
      return checked.filter((c) => c.enabled).map((c) => c.d)
    },
  })

  return {
    delegations: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}

// A failed enabled-read shouldn't hide a delegation — show it; the redeem reverts if revoked.
async function safeEnabled(d: StoredDelegation): Promise<boolean> {
  try {
    return await isDelegationEnabled(d.meta.chainId, d.meta.delegationHash)
  } catch {
    return true
  }
}
