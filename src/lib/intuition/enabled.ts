import { createPublicClient, http, parseAbi, type Hex } from 'viem'
import { getAddresses } from '../../config/addresses'
import { findChain, rpcUrl } from '../../config/supported-chains'

/**
 * Source of truth for active/revoked: the origin-chain DelegationManager.
 * Intuition indexes which delegations exist; this confirms one is still enabled
 * (not disabled via disableDelegation). See spec/intuition/README.md.
 */

const DELEGATION_MANAGER_ABI = parseAbi([
  'function disabledDelegations(bytes32 delegationHash) view returns (bool)',
])

export async function isDelegationEnabled(chainId: number, delegationHash: Hex): Promise<boolean> {
  const chain = findChain(chainId)
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`)
  const { delegationManager } = getAddresses(chainId)
  const client = createPublicClient({ chain, transport: http(rpcUrl(chainId)) })
  const disabled = await client.readContract({
    address: delegationManager,
    abi: DELEGATION_MANAGER_ABI,
    functionName: 'disabledDelegations',
    args: [delegationHash],
  })
  return !disabled
}
