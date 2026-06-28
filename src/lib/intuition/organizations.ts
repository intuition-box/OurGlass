import type { Address, Hex } from 'viem'
import { caip10Uri } from './discover'
import type { IntuitionNetwork } from './network'

/**
 * Read helpers for the organization picker on the create flows: search existing
 * Organization atoms by name (so "Base" is reused, not recreated), and prefill the
 * org that already `owns` a given Safe on the graph.
 */

interface OrgReadConfig {
  graphqlUrl: string
  network: IntuitionNetwork
  owns: Hex | null
}

const READ: Record<IntuitionNetwork, OrgReadConfig> = {
  testnet: {
    graphqlUrl: 'https://testnet.intuition.sh/v1/graphql',
    network: 'testnet',
    owns: '0xdd3eb9326e013e0ffecb067709bbf6cb6352122e025faede9c887b7c9ac4b773',
  },
  // term_ids unknown until predicates are created on mainnet (see ADR 0003).
  mainnet: { graphqlUrl: 'https://mainnet.intuition.sh/v1/graphql', network: 'mainnet', owns: null },
}

function activeRead(): OrgReadConfig {
  return import.meta.env.VITE_INTUITION_NETWORK === 'mainnet' ? READ.mainnet : READ.testnet
}

/** The Intuition network the app reads from (for portal links). */
export function activeIntuitionNetwork(): IntuitionNetwork {
  return activeRead().network
}

export interface OrgAtom {
  atomId: Hex
  name: string
}

async function gql<T>(url: string, query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: T; errors?: unknown }
    return body.data ?? null
  } catch {
    return null
  }
}

const ORG_SEARCH = `query($q: String!, $limit: Int!) {
  atoms(where: { _and: [{ type: { _eq: "Organization" } }, { label: { _ilike: $q } }] }
        limit: $limit order_by: { created_at: desc }) {
    term_id
    label
  }
}`

const ATOM_BY_DATA = `query($data: String!) { atoms(where: { data: { _eq: $data } }) { term_id } }`

const OWNS_BY_OBJECT = `query($ids: [String!], $owns: String!) {
  triples(where: { predicate: { term_id: { _eq: $owns } }, object_id: { _in: $ids } } limit: 1) {
    subject { term_id label type }
  }
}`

/** Existing Organization atoms whose name matches the query (for autocomplete). */
export async function searchOrganizations(query: string, limit = 8): Promise<OrgAtom[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const data = await gql<{ atoms: { term_id: Hex; label: string }[] }>(activeRead().graphqlUrl, ORG_SEARCH, {
    q: `%${q}%`,
    limit,
  })
  return (data?.atoms ?? []).map((a) => ({ atomId: a.term_id, name: a.label }))
}

/** The organization that already `owns` this Safe on the graph, if any (prefill). */
export async function findOwningOrganization(
  safeAddress: Address,
  safeChainId: number,
): Promise<OrgAtom | null> {
  const cfg = activeRead()
  if (!cfg.owns) return null
  const safeData = caip10Uri(safeChainId, safeAddress)
  const atoms = await gql<{ atoms: { term_id: string }[] }>(cfg.graphqlUrl, ATOM_BY_DATA, { data: safeData })
  const ids = (atoms?.atoms ?? []).map((a) => a.term_id)
  if (ids.length === 0) return null
  const triples = await gql<{ triples: { subject: { term_id: Hex; label: string; type: string } }[] }>(
    cfg.graphqlUrl,
    OWNS_BY_OBJECT,
    { ids, owns: cfg.owns },
  )
  const subject = triples?.triples[0]?.subject
  return subject ? { atomId: subject.term_id, name: subject.label } : null
}
