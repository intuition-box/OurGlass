import type { DelegationStruct } from '../delegations'

/**
 * The IPFS document behind a `DelegationJson` atom: a schema.org Thing (so the
 * Intuition indexer parses name/description into `atom.value.thing`) carrying the
 * atomic signed delegation under `delegation`. Relationship semantics live in the
 * triples; the Thing fields are display-only. See ADR 0004.
 *
 * The title is intentionally generic ("OurGlass delegation"); the human-readable
 * specifics (kind, enforcer, amount/period) go in the description, composed from
 * the delegation details the caller already has at signing time. The on-chain
 * caveat remains the source of truth — the description is display.
 */
export interface DelegationDocument {
  '@context': 'https://schema.org'
  '@type': 'Thing'
  name: string
  description: string
  image: string
  url: string
  delegation: DelegationStruct
}

/** A periodic-cap subscription (erc20PeriodTransfer) or an accruing stream (erc20Streaming). */
export type DelegationKind = 'subscription' | 'stream'

export interface DelegationDetails {
  kind: DelegationKind
  /** Human amount per period, e.g. "300". */
  amount: string
  /** Token ticker, e.g. "USDC". */
  tokenSymbol: string
  /** Human period noun, e.g. "month". */
  period: string
}

/** The canonical atom title. Intentionally generic — no amount/period. */
export const DELEGATION_DOCUMENT_NAME = 'OurGlass delegation'

const DEFAULT_URL = 'https://ourglass.intuition.box/'

const KIND_LABEL: Record<DelegationKind, string> = {
  subscription: 'Subscription',
  stream: 'Stream',
}

const KIND_ENFORCER: Record<DelegationKind, string> = {
  subscription: 'erc20PeriodTransfer',
  stream: 'erc20Streaming',
}

/** One human-readable sentence describing what the delegation authorizes. */
export function describeDelegation(details: DelegationDetails): string {
  return `${KIND_LABEL[details.kind]} delegation using the ${KIND_ENFORCER[details.kind]} enforcer for an amount of ${details.amount} ${details.tokenSymbol} / ${details.period}.`
}

export function buildDelegationDocument(params: {
  delegation: DelegationStruct
  details: DelegationDetails
  url?: string
  image?: string
}): DelegationDocument {
  return {
    '@context': 'https://schema.org',
    '@type': 'Thing',
    name: DELEGATION_DOCUMENT_NAME,
    description: describeDelegation(params.details),
    image: params.image ?? '',
    url: params.url ?? DEFAULT_URL,
    delegation: params.delegation,
  }
}
