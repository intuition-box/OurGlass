import type { StoredDelegation } from './storage'

/**
 * Deep-link to the independent, externally-hosted verifier (separate repo,
 * pinned to IPFS). The record travels in the URL *fragment* (`#d=…`), which the
 * browser never sends to the gateway server — it is only read client-side by the
 * verifier. The verdict is computed and shown on the verifier's own origin, not
 * here: OurGlass never renders a "verified" result itself (a compromised front
 * could fake that). Override the base with VITE_VERIFIER_URL.
 */
// Interim: the verifier's current IPFS CID (content-addressed, works today).
// Switch this default to https://verify.ourglass.eth.limo/ once the ENS name is
// registered — after that the URL is stable and re-pins don't change it.
// Production reads VITE_VERIFIER_URL; update it on each re-pin until ENS exists.
const VERIFIER_URL: string =
  import.meta.env.VITE_VERIFIER_URL ??
  'https://bafybeiaqtihw7t77vgx6s2q53uolr2v75ojvumhzae4dqa366ht2uyp2cm.ipfs.dweb.link/'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function verifierUrlFor(record: StoredDelegation): string {
  return `${VERIFIER_URL}#d=${toBase64Url(JSON.stringify(record))}`
}
