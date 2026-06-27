import { type Address, type Hex, keccak256, encodePacked, encodeAbiParameters, toHex } from 'viem'
import type { Caveat } from './storage'

// EIP-712 type hashes from the Delegation Framework (EncoderLib / Constants.sol).
// The delegation hash the DelegationManager passes to enforcers — and keys their
// per-delegation state on — is the struct hash below (no domain separator).
const DELEGATION_TYPEHASH = keccak256(
  toHex('Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)'),
)
const CAVEAT_TYPEHASH = keccak256(toHex('Caveat(address enforcer,bytes terms)'))

export interface DelegationStruct {
  delegate: Address
  delegator: Address
  authority: Hex
  caveats: Caveat[]
  salt: Hex
  signature: Hex
}

/**
 * The on-chain delegation hash, matching the Delegation Framework's
 * `EncoderLib._getDelegationHash`. This is the key enforcers use for their
 * per-delegation state, so it must be exact — an approximation makes the caveat
 * state (e.g. a stream's `spent`) unreadable. Verified equal to the value the
 * `DelegationManager` emits.
 */
export function computeDelegationHash(delegation: DelegationStruct): Hex {
  const caveatHashes = delegation.caveats.map((c) =>
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }],
        [CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)]
      )
    )
  )

  const caveatsHash = keccak256(
    encodePacked(
      caveatHashes.map(() => 'bytes32'),
      caveatHashes
    )
  )

  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      [
        DELEGATION_TYPEHASH,
        delegation.delegate,
        delegation.delegator,
        delegation.authority,
        caveatsHash,
        BigInt(delegation.salt),
      ]
    )
  )
}
