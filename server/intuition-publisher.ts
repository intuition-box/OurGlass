import { createPublicClient, createWalletClient, http, isHex, isAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  buildDelegationDocument,
  createGraphqlPinner,
  createViemChain,
  getIntuitionNetwork,
  publishDelegation,
  type DelegationDetails,
  type DelegationKind,
  type IntuitionNetwork,
} from '../src/lib/intuition'
import type { DelegationStruct } from '../src/lib/delegations'
import { isOriginAllowed, parseAllowedOrigins } from './cors'

/**
 * Intuition publisher: a node-side service that holds the funded attestor key and
 * records a signed OurGlass delegation on the Intuition graph. The Safe App calls
 * it right after a delegation is signed (the browser cannot hold the key). It
 * builds the DelegationJson document, pins it to IPFS, and writes the ontology.
 *
 * Env: INTUITION_ATTESTOR_PK (required), PINATA_JWT (required), INTUITION_NETWORK
 * (testnet|mainnet, default testnet), PORT (default 8787), ALLOWED_ORIGIN
 * (default *), PUBLISH_SECRET (optional — if set, require x-publish-secret).
 */

const pk = process.env.INTUITION_ATTESTOR_PK
const pinataJwt = process.env.PINATA_JWT
const network = (process.env.INTUITION_NETWORK ?? 'testnet') as IntuitionNetwork
const port = Number(process.env.PORT ?? '8787')
const publishSecret = process.env.PUBLISH_SECRET

// The matched request origin is echoed back (never a bare `*`), so PR preview
// subdomains are accepted without per-PR config. See server/cors.ts.
const allowedOriginPatterns = parseAllowedOrigins(process.env.ALLOWED_ORIGIN)

const config = getIntuitionNetwork(network)

// Start regardless of config so /health always answers and reports what's missing
// (a misconfigured deploy must be diagnosable, not a dead process behind a 502).
const missing: string[] = []
if (!pk || !isHex(pk)) missing.push('INTUITION_ATTESTOR_PK')
if (!pinataJwt) missing.push('PINATA_JWT')

interface Runtime {
  account: ReturnType<typeof privateKeyToAccount>
  chain: ReturnType<typeof createViemChain>
  pinner: ReturnType<typeof createGraphqlPinner>
  pinataJwt: string
}

function buildRuntime(): Runtime | null {
  if (!pk || !isHex(pk) || !pinataJwt) return null
  const account = privateKeyToAccount(pk)
  const transport = http(config.rpcUrl)
  const chain = createViemChain(
    createPublicClient({ chain: config.chain, transport }),
    createWalletClient({ account, chain: config.chain, transport }),
    config.multiVault,
  )
  return { account, chain, pinner: createGraphqlPinner(config.graphqlUrl), pinataJwt }
}

const runtime = buildRuntime()

interface PublishBody {
  delegation: DelegationStruct
  chainId: number
  details: DelegationDetails
  organization?: { name?: string; url?: string }
}

function asHex(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value)) throw new Error(`invalid hex: ${field}`)
  return value
}

function asAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error(`invalid address: ${field}`)
  return value
}

const KINDS: DelegationKind[] = ['subscription', 'stream']

function parseBody(raw: unknown): PublishBody {
  if (typeof raw !== 'object' || raw === null) throw new Error('body must be an object')
  const b = raw as Record<string, unknown>
  const d = b.delegation as Record<string, unknown> | undefined
  if (!d) throw new Error('delegation is required')
  if (!Array.isArray(d.caveats)) throw new Error('delegation.caveats must be an array')
  const delegation: DelegationStruct = {
    delegate: asAddress(d.delegate, 'delegation.delegate'),
    delegator: asAddress(d.delegator, 'delegation.delegator'),
    authority: asHex(d.authority, 'delegation.authority'),
    caveats: d.caveats.map((c, i) => {
      const cv = c as Record<string, unknown>
      return { enforcer: asAddress(cv.enforcer, `caveat[${i}].enforcer`), terms: asHex(cv.terms, `caveat[${i}].terms`) }
    }),
    salt: asHex(d.salt, 'delegation.salt'),
    signature: asHex(d.signature, 'delegation.signature'),
  }
  const chainId = Number(b.chainId)
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('chainId must be a positive integer')
  const det = b.details as Record<string, unknown> | undefined
  if (!det || !KINDS.includes(det.kind as DelegationKind)) throw new Error('details.kind must be subscription|stream')
  const details: DelegationDetails = {
    kind: det.kind as DelegationKind,
    amount: String(det.amount ?? ''),
    tokenSymbol: String(det.tokenSymbol ?? ''),
    period: String(det.period ?? ''),
  }
  const org = b.organization as { name?: string; url?: string } | undefined
  return { delegation, chainId, details, organization: org }
}

async function pinToPinata(jwt: string, content: unknown, name: string): Promise<string> {
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: { name } }),
  })
  if (!res.ok) throw new Error(`Pinata pin failed (${res.status}): ${await res.text()}`)
  return `ipfs://${((await res.json()) as { IpfsHash: string }).IpfsHash}`
}

// Serialize publishes so concurrent requests don't collide on the attestor nonce.
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

async function handlePublish(rt: Runtime, body: PublishBody): Promise<{ uri: string; result: unknown }> {
  const doc = buildDelegationDocument({ delegation: body.delegation, details: body.details })
  const uri = await pinToPinata(rt.pinataJwt, doc, 'ourglass-delegation')
  const result = await publishDelegation(
    { chain: rt.chain, pinner: rt.pinner, config },
    {
      delegator: { address: body.delegation.delegator, chainId: body.chainId },
      recipient: { kind: 'caip10', address: body.delegation.delegate, chainId: body.chainId },
      organization: {
        name: body.organization?.name ?? 'OurGlass',
        description: '',
        image: '',
        url: body.organization?.url ?? '',
        email: '',
      },
      agreementUri: uri,
    },
  )
  return { uri, result }
}

function cors(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-publish-secret',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(origin, allowedOriginPatterns)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function json(payload: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  })
}

Bun.serve({
  port,
  async fetch(req) {
    const origin = req.headers.get('Origin')
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
    const url = new URL(req.url)
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(
        { ok: true, network, ready: runtime !== null, missing, attestor: runtime?.account.address ?? null },
        200,
        origin,
      )
    }
    if (req.method === 'POST' && url.pathname === '/publish') {
      if (!runtime) {
        return json({ error: 'publisher not configured', missing }, 503, origin)
      }
      if (publishSecret && req.headers.get('x-publish-secret') !== publishSecret) {
        return json({ error: 'unauthorized' }, 401, origin)
      }
      try {
        const body = parseBody(await req.json())
        const out = await enqueue(() => handlePublish(runtime, body))
        return json(out, 200, origin)
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'publish failed' }, 400, origin)
      }
    }
    return json({ error: 'not found' }, 404, origin)
  },
})

console.log(
  runtime
    ? `intuition-publisher on :${port} → ${network} (attestor ${runtime.account.address})`
    : `intuition-publisher on :${port} → ${network} — NOT READY, missing: ${missing.join(', ')}`,
)
