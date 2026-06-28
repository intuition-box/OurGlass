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
| `INTUITION_PUBLISHER_PORT` | no | `8787` | Own var; a platform-injected `PORT` would otherwise repoint the listener. |
| `ALLOWED_ORIGIN` | no | apex + `*.ourglass.intuition.box` + localhost | Comma-separated; supports `*` and subdomain wildcards. Default accepts every PR preview subdomain. |
| `PUBLISH_SECRET` | no | — | If set, require `x-publish-secret` to match. |

## Deploy

### Recommended: same app (default)

The root `Dockerfile` already runs this publisher **inside the web container**:
Caddy serves the static apps and reverse-proxies `/intuition/*` to the publisher
(`server/entrypoint.sh` starts both). One deploy, one origin, no CORS, no separate
domain or cert — and it works on every PR preview automatically. The Safe App's
`VITE_INTUITION_PUBLISHER_URL` defaults to `/intuition` (a same-origin path), so
there's nothing to set on the frontend.

You only set the publisher's **runtime** secrets on the existing Coolify app
(regular env vars, NOT build args, NEVER `VITE_`-prefixed):

- `INTUITION_ATTESTOR_PK` — the funded attestor key
- `PINATA_JWT` — the Pinata JWT
- (`INTUITION_NETWORK` defaults to `testnet` in the image)

Then redeploy. Verify: `https://<host>/intuition/health` → `{"ok":true,...}`. If the
publisher can't start (e.g. missing key), Caddy still serves the site — auto-publish
just degrades to "publishing not configured".

### Alternative: standalone service

To run it separately instead, use `server/Dockerfile` (build context = repo root)
as its own Coolify service, set the env vars above on that service, and point the
Safe App's `VITE_INTUITION_PUBLISHER_URL` build var at its URL. Its default CORS
accepts `https://*.ourglass.intuition.box`, so previews work without per-PR setup.

## Abuse note

The `POST /publish` endpoint spends the attestor's $TRUST per call. For a
public demo it is rate-unbounded; set `PUBLISH_SECRET` (and `ALLOWED_ORIGIN`) to
limit drive-by use, and keep the attestor funded with testnet tTRUST only. A
stronger guard (verify the delegation signature / EIP-1271, per-origin rate
limits) is a follow-up.
