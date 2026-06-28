import type { Hex } from 'viem'
import type { DelegationStruct } from './delegations'
import type { DelegationDetails, IntuitionNetwork } from './intuition'

/**
 * Client for the Intuition publisher backend. The browser cannot hold the
 * attestor key, so writing the delegation onto the graph is delegated to a
 * node-side service (see server/intuition-publisher.ts). Configured via
 * VITE_INTUITION_PUBLISHER_URL; absent → publishing is simply disabled.
 */

export interface PublishRequest {
  delegation: DelegationStruct
  chainId: number
  details: DelegationDetails
  organization?: { name: string; url?: string }
}

export interface PublishResponse {
  uri: string
  // The publisher returns the full PublishResult; we only read these fields.
  result: { network: IntuitionNetwork; atoms: { delegationJson: Hex } }
}

export function intuitionPublisherUrl(): string | null {
  const url = import.meta.env.VITE_INTUITION_PUBLISHER_URL
  return typeof url === 'string' && url.length > 0 ? url.replace(/\/$/, '') : null
}

export async function publishDelegationToIntuition(req: PublishRequest): Promise<PublishResponse> {
  const base = intuitionPublisherUrl()
  if (!base) throw new Error('VITE_INTUITION_PUBLISHER_URL is not configured')
  const secret = import.meta.env.VITE_INTUITION_PUBLISHER_SECRET
  const res = await fetch(`${base}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(typeof secret === 'string' && secret ? { 'x-publish-secret': secret } : {}),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`publisher ${res.status}: ${await res.text()}`)
  // Network boundary: the backend returns exactly this shape (server/intuition-publisher.ts).
  return (await res.json()) as PublishResponse
}
