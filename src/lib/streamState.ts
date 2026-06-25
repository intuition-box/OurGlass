import { type Address, type Hex, type PublicClient } from 'viem'
import { type Caveat } from './storage'

/**
 * The erc20Streaming caveat enforcer keeps per-delegation state once a stream has
 * been redeemed at least once. Reading it gives the on-chain truth: how much has
 * been claimed (`spent`) and how much is claimable right now (`getAvailableAmount`,
 * already net of `spent`) — more accurate than the off-chain accrual estimate.
 *
 * Until the first redeem the enforcer storage is empty (`streamingAllowances`
 * returns zeros): the stream is reported as not-yet-initialized so the caller can
 * fall back to the estimate derived from the signed terms.
 */
const STREAMING_ENFORCER_ABI = [
  {
    type: 'function',
    name: 'getAvailableAmount',
    stateMutability: 'view',
    inputs: [
      { name: '_delegationManager', type: 'address' },
      { name: '_delegationHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'availableAmount_', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'streamingAllowances',
    stateMutability: 'view',
    inputs: [
      { name: 'delegationManager', type: 'address' },
      { name: 'delegationHash', type: 'bytes32' },
    ],
    outputs: [
      { name: 'initialAmount', type: 'uint256' },
      { name: 'maxAmount', type: 'uint256' },
      { name: 'amountPerSecond', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'spent', type: 'uint256' },
    ],
  },
] as const

export interface StreamEnforcerState {
  /** The caveat enforcer address that holds the streaming state. */
  enforcer: Address
  /** True once the stream has been redeemed at least once (storage populated). */
  initialized: boolean
  /** Amount already claimed/redeemed, raw wei. */
  spent: bigint
  /** Claimable right now, net of `spent`, raw wei. */
  available: bigint
  /** Lifetime cap, raw wei (may be MAX_UINT256 for an unbounded stream). */
  maxAmount: bigint
}

/**
 * Read the streaming enforcer state for a delegation. The streaming caveat is
 * identified by trying each stored caveat's enforcer — the streaming enforcer is
 * the one where both reads resolve; other enforcers (e.g. timestamp) revert.
 * Returns `null` if no caveat exposes the streaming interface.
 */
export async function readStreamState(
  client: PublicClient,
  caveats: readonly Caveat[],
  delegationManager: Address,
  delegationHash: Hex,
): Promise<StreamEnforcerState | null> {
  for (const caveat of caveats) {
    try {
      const allowance = await client.readContract({
        address: caveat.enforcer,
        abi: STREAMING_ENFORCER_ABI,
        functionName: 'streamingAllowances',
        args: [delegationManager, delegationHash],
      })
      const available = await client.readContract({
        address: caveat.enforcer,
        abi: STREAMING_ENFORCER_ABI,
        functionName: 'getAvailableAmount',
        args: [delegationManager, delegationHash],
      })
      const [, maxAmount, amountPerSecond, startTime, spent] = allowance
      return {
        enforcer: caveat.enforcer,
        initialized: amountPerSecond > 0n || startTime > 0n,
        spent,
        available,
        maxAmount,
      }
    } catch {
      // Not the streaming enforcer for this caveat — try the next one.
    }
  }
  return null
}
