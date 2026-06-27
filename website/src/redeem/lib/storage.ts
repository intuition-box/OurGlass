import { type Address, type Hex } from 'viem'

export interface Caveat {
  enforcer: Address
  terms: Hex
}

export interface StoredDelegation {
  delegation: {
    delegate: Address
    delegator: Address
    authority: Hex
    caveats: Caveat[]
    salt: Hex
    signature: Hex
  }
  meta: {
    label: string
    scopeType: 'ethSpendingLimit' | 'erc20SpendingLimit' | 'erc20Streaming' | 'transferIntent' | 'swapIntent' | 'custom'
    createdAt: string
    chainId: number
    safeAddress: Address
    moduleAddress: Address
    status: 'pending' | 'signed' | 'revoked'
    delegationHash: Hex
    // Subscription contract pinned to IPFS, hash bound to the signature salt
    agreement?: { cid: string; uri: string; termsHash: Hex }
    // Human-readable details
    amount?: string
    period?: string
    tokenAddress?: Address
    expiryDate?: string
    // Where the funds are paid — the payee, who is also the delegate.
    recipient?: Address
    // Streaming-specific (scopeType === 'erc20Streaming'). The erc20Streaming
    // caveat accrues linearly: balance = min(maxAmount, initialAmount +
    // amountPerSecond * (now - startTime)). All amounts are raw wei strings.
    amountPerSecond?: string
    initialAmount?: string
    maxAmount?: string
    startTime?: number
    // Display-only: the human rate the beneficiary signed up for (e.g. "1000" / "monthly").
    ratePerPeriod?: string
    ratePeriod?: string
    // Custom delegation meta
    targetAddress?: Address
    methodSelector?: Hex
    calldataArgs?: Hex
    maxValue?: string
    recipeName?: string
    customParams?: {
      name: string
      type: string
      value: string
      enforced: boolean
      locked: boolean
    }[]
  }
}

/** Parse a delegations export (bundle or single delegation) into stored entries. */
export function importDelegationsJson(json: string): StoredDelegation[] {
  const parsed = JSON.parse(json)
  if (parsed.version && parsed.delegations) {
    return parsed.delegations
  }
  // Maybe it's a single delegation
  if (parsed.delegation && parsed.meta) {
    return [parsed]
  }
  throw new Error('Invalid delegation JSON format')
}
