import type { StoredDelegation } from './storage'

/**
 * Deep-link to the independent, externally-hosted verifier (separate repo,
 * pinned to IPFS). The record travels in the URL *fragment* (`#d=…`), which the
 * browser never sends to the gateway server — it is only read client-side by the
 * verifier. The verdict is computed and shown on the verifier's own origin, not
 * here: OurGlass never renders a "verified" result itself (a compromised front
 * could fake that). Override the base with VITE_VERIFIER_URL.
 */
// Default = the verifier's current IPFS CID (content-addressed). The CID changes
// on each re-pin of the verifier, so update this default — or set
// VITE_VERIFIER_URL in production — whenever the verifier is rebuilt.
const VERIFIER_URL: string =
  import.meta.env.VITE_VERIFIER_URL ??
  'https://bafybeigja45di5agun7qdwaz3dqiyrrtrqbdm4thwhfgc6nc4fwtjkjuqu.ipfs.dweb.link/'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function verifierUrlFor(record: StoredDelegation): string {
  return `${VERIFIER_URL}#d=${toBase64Url(JSON.stringify(record))}`
}
