import {
  redeemDelegations,
  createExecution,
  ExecutionMode,
  type Delegation,
} from '@metamask/smart-accounts-kit'
import {
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { getAddresses } from '../config/addresses'
import type { StoredDelegation } from './storage'

export interface RedeemDirectParams {
  walletClient: WalletClient
  publicClient: PublicClient
  chainId: number
  delegation: StoredDelegation['delegation']
  token: { address: Address; decimals: number }
  /** Amount to transfer this period, in human units. */
  amount: string
  recipient: Address
}

/**
 * Redeem one subscription period directly on-chain. The delegate (org EOA) sends
 * DelegationManager.redeemDelegations with a single ERC20 transfer to the recipient,
 * bounded on-chain by the signed erc20PeriodTransfer caveat. Gas is paid in ETH by
 * the delegate — no relayer. Returns the transaction hash.
 */
export async function redeemSubscriptionDirect(params: RedeemDirectParams): Promise<Hex> {
  const { walletClient, publicClient, chainId, delegation, token, amount, recipient } = params
  const { delegationManager } = getAddresses(chainId)

  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, parseUnits(amount, token.decimals)],
  })
  const execution = createExecution({ target: token.address, value: 0n, callData })

  // The signed delegation matches the SDK Delegation shape; caveats carry an empty
  // runtime `args` (erc20PeriodTransfer takes none).
  const permissionContext: Delegation[] = [
    {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: '0x' })),
      salt: delegation.salt,
      signature: delegation.signature,
    },
  ]

  return redeemDelegations(walletClient, publicClient, delegationManager, [
    { permissionContext, mode: ExecutionMode.SingleDefault, executions: [execution] },
  ])
}
