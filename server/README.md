# Intuition publisher backend

A small node service (`Bun.serve`) that records a signed OurGlass delegation on
the Intuition graph. The Safe App is client-side and cannot hold the attestor
key, so it POSTs the signed delegation here; this service builds the
`DelegationJson` document, pins it to IPFS, and writes the nested-triple ontology
(see `spec/intuition/README.md`, ADR 0003/0004).

## Run

```bash
INTUITION_ATTESTOR_PK=0x... PINATA_JWT=... bun run publisher
# or: bun server/intuition-publisher.ts
```

## Endpoints

- `GET /health` → `{ ok, network, attestor }`
- `POST /publish` — body:
  ```json
  {
    "delegation": { "delegate", "delegator", "authority", "caveats": [{ "enforcer", "terms" }], "salt", "signature" },
    "chainId": 84532,
    "details": { "kind": "subscription", "amount": "300", "tokenSymbol": "USDC", "period": "month" },
    "organization": { "name": "intuition.box" }
  }
  ```
  → `{ "uri": "ipfs://…", "result": { atoms, triples, created } }`

Publishes are serialized in-process so concurrent requests don't collide on the
attestor nonce.

## Env

| Var | Required | Default | Notes |
|---|---|---|---|
| `INTUITION_ATTESTOR_PK` | yes | — | Funded attestor key. **Server-side only.** |
| `PINATA_JWT` | yes | — | Pins the DelegationJson document (server-side; no `VITE_`). |
| `INTUITION_NETWORK` | no | `testnet` | `testnet` (13579) or `mainnet` (1155). |
| `PORT` | no | `8787` | |
| `ALLOWED_ORIGIN` | no | apex + `*.ourglass.intuition.box` + localhost | Comma-separated; supports `*` and subdomain wildcards. Default accepts every PR preview subdomain. |
| `PUBLISH_SECRET` | no | — | If set, require `x-publish-secret` to match. |

## Coolify

Deploy as a **separate service** from the static Safe App:

- Dockerfile: `server/Dockerfile`, build context = repo root.
- Set the env vars above (NOT as build args — they're runtime secrets).
- Point the Safe App's `VITE_INTUITION_PUBLISHER_URL` at this service's URL.

### Preview deployments

One shared publisher serves all PR previews. Define `VITE_INTUITION_PUBLISHER_URL`
(and `VITE_PINATA_JWT`) as **project-level build variables** in Coolify so every
preview build bakes them in (Vite inlines `VITE_*` at build time — see the build
args in the root `Dockerfile`). The publisher's default CORS already accepts
`https://*.ourglass.intuition.box`, so preview origins work without per-PR setup.

## Abuse note

The `POST /publish` endpoint spends the attestor's $TRUST per call. For a
public demo it is rate-unbounded; set `PUBLISH_SECRET` (and `ALLOWED_ORIGIN`) to
limit drive-by use, and keep the attestor funded with testnet tTRUST only. A
stronger guard (verify the delegation signature / EIP-1271, per-origin rate
limits) is a follow-up.
