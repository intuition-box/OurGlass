import type { Address, Hex } from 'viem'
import type { StoredDelegation } from '../storage'
import {
  atomDataFromUri,
  caip10Uri,
  recipientUri,
  type IntuitionPinner,
  type RecipientAtom,
} from './atoms'
import type { CreatePreview, IntuitionChain } from './chain'
import type {
  IntuitionNetwork,
  IntuitionNetworkConfig,
  OrganizationMeta,
  PredicateRef,
} from './network'

/**
 * Write path: given a signed OurGlass delegation, record it on the Intuition
 * graph as the nested-triple ontology in spec/intuition/README.md:
 *
 *   (Organization)   —owns→         (delegator CAIP-10)
 *   (delegator)      —delegate to→   (recipient)            = relationship triple
 *   (DelegationJson) —in context of→ (relationship triple)  = nested binding
 *
 * Every create is existence-checked, previewed, and post-write verified, so the
 * flow is idempotent — re-running skips terms that already exist.
 */

export interface PublishDelegationInput {
  delegator: { address: Address; chainId: number }
  recipient: RecipientAtom
  organization: OrganizationMeta
  /** The DelegationJson: the agreement OurGlass already pinned (ipfs://...). */
  agreementUri: string
}

export interface PublishResult {
  network: IntuitionNetwork
  predicates: { owns: Hex; delegateTo: Hex; inContextOf: Hex }
  atoms: { delegator: Hex; recipient: Hex; organization: Hex; delegationJson: Hex }
  triples: { relationship: Hex; ownership: Hex; context: Hex }
  /** term_ids actually created this run (empty on a full re-run). */
  created: Hex[]
}

export interface PublishDeps {
  chain: IntuitionChain
  pinner: IntuitionPinner
  config: IntuitionNetworkConfig
}

function assertMintable(label: string, preview: CreatePreview): void {
  if (preview.assetsAfterFixedFees > 0n && preview.shares === 0n) {
    throw new Error(`${label}: a non-zero deposit would mint zero shares`)
  }
}

export async function publishDelegation(
  deps: PublishDeps,
  input: PublishDelegationInput,
): Promise<PublishResult> {
  const { chain, pinner, config } = deps
  if (!input.agreementUri.startsWith('ipfs://')) {
    throw new Error(`agreementUri must be an ipfs:// URI, got "${input.agreementUri}"`)
  }

  const atomCost = await chain.getAtomCost()
  const tripleCost = await chain.getTripleCost()
  const created: Hex[] = []

  async function ensureAtom(uri: string): Promise<Hex> {
    const data = atomDataFromUri(uri)
    const id = await chain.calculateAtomId(data)
    if (await chain.isTermCreated(id)) return id
    assertMintable(`atom ${uri}`, await chain.previewAtomCreate(id, atomCost))
    const createdId = await chain.createAtom(data, atomCost)
    created.push(createdId)
    return createdId
  }

  async function ensureTriple(subject: Hex, predicate: Hex, object: Hex): Promise<Hex> {
    const id = await chain.calculateTripleId(subject, predicate, object)
    if (await chain.isTermCreated(id)) return id
    assertMintable(`triple ${id}`, await chain.previewTripleCreate(id, tripleCost))
    const createdId = await chain.createTriple(subject, predicate, object, tripleCost)
    created.push(createdId)
    return createdId
  }

  async function resolvePredicate(ref: PredicateRef): Promise<Hex> {
    if (ref.termId !== null) {
      if (!(await chain.isTermCreated(ref.termId))) {
        throw new Error(
          `configured predicate "${ref.label}" (${ref.termId}) not found on ${config.network}`,
        )
      }
      return ref.termId
    }
    return ensureAtom(await pinner.pinThing(ref.pin))
  }

  const owns = await resolvePredicate(config.predicates.owns)
  const delegateTo = await resolvePredicate(config.predicates.delegateTo)
  const inContextOf = await resolvePredicate(config.predicates.inContextOf)

  const delegatorAtom = await ensureAtom(
    caip10Uri(input.delegator.chainId, input.delegator.address),
  )
  const recipientAtom = await ensureAtom(recipientUri(input.recipient, config.chainId))
  const organizationAtom = await ensureAtom(await pinner.pinOrganization(input.organization))
  const delegationJsonAtom = await ensureAtom(input.agreementUri)

  const relationship = await ensureTriple(delegatorAtom, delegateTo, recipientAtom)
  const ownership = await ensureTriple(organizationAtom, owns, delegatorAtom)
  const context = await ensureTriple(delegationJsonAtom, inContextOf, relationship)

  return {
    network: config.network,
    predicates: { owns, delegateTo, inContextOf },
    atoms: {
      delegator: delegatorAtom,
      recipient: recipientAtom,
      organization: organizationAtom,
      delegationJson: delegationJsonAtom,
    },
    triples: { relationship, ownership, context },
    created,
  }
}

/**
 * Derive a publish input from a stored OurGlass delegation. The org metadata is
 * supplied by the caller (localStorage meta carries no org name); the recipient
 * defaults to a plain CAIP-10 account unless an atom-wallet recipient is passed.
 */
export function inputFromStoredDelegation(
  delegation: StoredDelegation,
  organization: OrganizationMeta,
  recipient?: RecipientAtom,
): PublishDelegationInput {
  const agreementUri = delegation.meta.agreement?.uri
  if (!agreementUri) {
    throw new Error('delegation has no pinned agreement URI to use as DelegationJson')
  }
  return {
    delegator: { address: delegation.delegation.delegator, chainId: delegation.meta.chainId },
    recipient:
      recipient ?? {
        kind: 'caip10',
        address: delegation.meta.recipient ?? delegation.delegation.delegate,
        chainId: delegation.meta.chainId,
      },
    organization,
    agreementUri,
  }
}
