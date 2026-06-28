import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { discoverIncomingDelegations } from '../lib/intuition/discover'
import { isDelegationEnabled } from '../lib/intuition/enabled'
import type { StoredDelegation } from '../lib/storage'

/**
 * Active delegations made TO the connected account, discovered on Intuition and
 * cross-checked enabled on the origin-chain DelegationManager. Drives the default
 * redeem view (manual import stays as a fallback).
 */
export function useIncomingDelegations(): {
  delegations: StoredDelegation[]
  loading: boolean
  error: unknown
  refetch: () => void
} {
  const { address, chainId, isConnected } = useAccount()

  const query = useQuery({
    queryKey: ['incoming-delegations', address, chainId],
    enabled: Boolean(isConnected && address && chainId),
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
