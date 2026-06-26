import { type Address, type Hex, type PublicClient } from 'viem'
import { type Caveat } from './storage'

/**
 * The erc20PeriodTransfer caveat enforcer (the subscription cap) exposes the
 * current-period accounting. Unlike the streaming enforcer, `getAvailableAmount`
 * takes the caveat terms, so it reports the claimable amount even before the first
 * redeem (empty storage → fresh period → the full period cap is available).
 *
 *   claimedThisPeriod = periodAmount - available
 */
const PERIOD_ENFORCER_ABI = [
  {
    type: 'function',
    name: 'getAvailableAmount',
    stateMutability: 'view',
    inputs: [
      { name: '_delegationHash', type: 'bytes32' },
      { name: '_delegationManager', type: 'address' },
      { name: '_terms', type: 'bytes' },
    ],
    outputs: [
      { name: 'availableAmount_', type: 'uint256' },
      { name: 'isNewPeriod_', type: 'bool' },
      { name: 'currentPeriod_', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getTermsInfo',
    stateMutability: 'pure',
    inputs: [{ name: '_terms', type: 'bytes' }],
    outputs: [
      { name: 'token_', type: 'address' },
      { name: 'periodAmount_', type: 'uint256' },
      { name: 'periodDuration_', type: 'uint256' },
      { name: 'startDate_', type: 'uint256' },
    ],
  },
] as const

export interface PeriodEnforcerState {
  /** The caveat enforcer address that holds the period accounting. */
  enforcer: Address
  /** The cap per period, raw wei. */
  periodAmount: bigint
  /** Claimable right now within the current period, raw wei. */
  available: bigint
  /** Already claimed in the current period, raw wei (`periodAmount - available`). */
  claimedThisPeriod: bigint
  /** Period length in seconds. */
  periodDuration: bigint
}

/**
 * Read the period-transfer enforcer state for a subscription delegation. The
 * caveat is identified by trying each stored caveat's (enforcer, terms) pair — the
 * period enforcer is the one where both reads resolve; other enforcers revert.
 * Returns `null` if no caveat exposes the period-transfer interface.
 */
export async function readPeriodState(
  client: PublicClient,
  caveats: readonly Caveat[],
  delegationManager: Address,
  delegationHash: Hex,
): Promise<PeriodEnforcerState | null> {
  for (const caveat of caveats) {
    try {
      const info = await client.readContract({
        address: caveat.enforcer,
        abi: PERIOD_ENFORCER_ABI,
        functionName: 'getTermsInfo',
        args: [caveat.terms],
      })
      const avail = await client.readContract({
        address: caveat.enforcer,
        abi: PERIOD_ENFORCER_ABI,
        functionName: 'getAvailableAmount',
        args: [delegationHash, delegationManager, caveat.terms],
      })
      const periodAmount = info[1]
      const periodDuration = info[2]
      const available = avail[0]
      return {
        enforcer: caveat.enforcer,
        periodAmount,
        available,
        claimedThisPeriod: periodAmount > available ? periodAmount - available : 0n,
        periodDuration,
      }
    } catch {
      // Not the period-transfer enforcer for this caveat — try the next one.
    }
  }
  return null
}
