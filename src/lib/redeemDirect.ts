import {
  redeemDelegations,
  createExecution,
  ExecutionMode,
  type Delegation,
} from '@metamask/smart-accounts-kit'
import { encodePermissionContexts, encodeExecutionCalldatas } from '@metamask/smart-accounts-kit/utils'
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

const REDEEM_DELEGATIONS_ABI = [
  {
    type: 'function',
    name: 'redeemDelegations',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
  },
] as const

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

export interface RedeemTxParams {
  chainId: number
  delegation: StoredDelegation['delegation']
  token: { address: Address; decimals: number }
  /** Amount to transfer this period, in human units. */
  amount: string
  recipient: Address
}

export interface RedeemTx {
  to: Address
  value: '0'
  data: Hex
}

/**
 * Build the DelegationManager.redeemDelegations transaction (calldata) for one
 * period: a single ERC20 transfer to the recipient, bounded on-chain by the signed
 * erc20PeriodTransfer caveat. The returned tx must be sent BY the delegate — used
 * for the Safe-delegate path via `sdk.txs.send`. Gas is paid in ETH by the sender.
 */
export function buildRedeemTx(params: RedeemTxParams): RedeemTx {
  const { chainId, delegation, token, amount, recipient } = params
  const { delegationManager } = getAddresses(chainId)

  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, parseUnits(amount, token.decimals)],
  })
  const execution = createExecution({ target: token.address, value: 0n, callData })

  const sdkDelegation: Delegation = {
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority,
    caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: '0x' })),
    salt: delegation.salt,
    signature: delegation.signature,
  }

  const data = encodeFunctionData({
    abi: REDEEM_DELEGATIONS_ABI,
    functionName: 'redeemDelegations',
    args: [
      encodePermissionContexts([[sdkDelegation]]),
      [ExecutionMode.SingleDefault],
      encodeExecutionCalldatas([[execution]]),
    ],
  })

  return { to: delegationManager, value: '0', data }
}
