import { getAddress, stringToHex, type Address, type Hex } from 'viem'
import type { OrganizationMeta, ThingMeta } from './network'

/**
 * Atom data encoding + IPFS pinning for the Intuition write path.
 *
 * Accounts are encoded as CAIP-10 URIs (no IPFS); concepts/orgs are pinned to
 * IPFS first. The `DelegationJson` atom reuses the agreement URI OurGlass
 * already pins, so it is not re-pinned here.
 */

/** The Intuition recipient by kind (see spec/intuition/README.md). */
export type RecipientAtom =
  | { kind: 'caip10'; address: Address; chainId: number }
  // The Account Wallet derived from an atom (computeAtomWalletAddr). The caller
  // supplies the already-computed wallet address; it lives on the Intuition L3.
  | { kind: 'atomWallet'; walletAddress: Address }

/** CAIP-10 account URI. Address is EIP-55 checksummed to match the canonical encoding. */
export function caip10Uri(chainId: number, address: Address): string {
  return `caip10:eip155:${chainId}:${getAddress(address)}`
}

export function recipientUri(recipient: RecipientAtom, intuitionChainId: number): string {
  return recipient.kind === 'caip10'
    ? caip10Uri(recipient.chainId, recipient.address)
    : caip10Uri(intuitionChainId, recipient.walletAddress)
}

/** Encode an atom URI (ipfs:// or caip10:) as the bytes passed to createAtoms. */
export function atomDataFromUri(uri: string): Hex {
  return stringToHex(uri)
}

/** Pins structured atom metadata to IPFS and returns an `ipfs://` URI. */
export interface IntuitionPinner {
  pinThing(thing: ThingMeta): Promise<string>
  pinOrganization(org: OrganizationMeta): Promise<string>
}

const PIN_THING = `mutation pinThing($name: String!, $description: String!, $image: String!, $url: String!) {
  pinThing(thing: { name: $name, description: $description, image: $image, url: $url }) { uri }
}`

const PIN_ORGANIZATION = `mutation pinOrganization($name: String!, $description: String!, $image: String!, $url: String!, $email: String!) {
  pinOrganization(organization: { name: $name, description: $description, image: $image, url: $url, email: $email }) { uri }
}`

interface PinResponse {
  data?: { pinThing?: { uri?: string }; pinOrganization?: { uri?: string } }
  errors?: { message: string }[]
}

async function pin(
  graphqlUrl: string,
  query: string,
  variables: ThingMeta | OrganizationMeta,
  field: 'pinThing' | 'pinOrganization',
): Promise<string> {
  if (!variables.name) throw new Error('Pin failed — name is required')
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Pin failed — HTTP ${res.status}`)
  const body = (await res.json()) as PinResponse
  if (body.errors?.length) {
    throw new Error(`Pin failed — GraphQL errors: ${JSON.stringify(body.errors)}`)
  }
  const uri = body.data?.[field]?.uri
  if (!uri || !uri.startsWith('ipfs://')) {
    throw new Error(`Pin failed — no valid IPFS URI for "${variables.name}"`)
  }
  return uri
}

/** Default pinner: hits the Intuition GraphQL pin mutations (no auth, no gas). */
export function createGraphqlPinner(graphqlUrl: string): IntuitionPinner {
  return {
    pinThing: (thing) => pin(graphqlUrl, PIN_THING, thing, 'pinThing'),
    pinOrganization: (org) => pin(graphqlUrl, PIN_ORGANIZATION, org, 'pinOrganization'),
  }
}
