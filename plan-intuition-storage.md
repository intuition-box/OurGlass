# Plan — Store OurGlass delegations on Intuition (Phases 1+2)

Spec: `spec/intuition/README.md`. Ontology: `spec/intuition/ontology.png`.

## Decisions (confirmed with user 2026-06-28)

- **Scope this task:** Phase 1 (read-only verify) + Phase 2 (pure write service). No
  query layer, no showcase UI.
- **Payer:** OurGlass attestor wallet (funded tTRUST key). Needs a funded testnet key.
- **Network:** Intuition Testnet `13579` first (MultiVault
  `0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91`, RPC
  `https://testnet.rpc.intuition.systems/http`, GraphQL
  `https://testnet.intuition.sh/v1/graphql`). Mainnet `1155` later.
- **Active/revoked:** chain `DelegationManager` = source of truth; Intuition = index.
- **Trigger:** auto-write on successful sign — but the browser trigger is Phase 4 and
  needs a signer endpoint (see Constraint). For Phases 1+2 the service is Node-side.

## Hard constraint (raised before build)

The Safe App is client-side only (`src/`, no backend). A `VITE_*` env var is bundled
into public JS, so the attestor private key **cannot** live in the browser. Therefore:

- Phases 1+2: write service is a pure TS module signing from Node (`scripts/` / `test/`),
  key in a non-`VITE_` env var (`INTUITION_ATTESTOR_PK`).
- Phase 4 (later): the auto-on-sign browser trigger requires a minimal signer endpoint
  (serverless fn holding the key). Out of scope here; documented as a Phase-4 prereq.

## Phase 1 — Verify on the live testnet graph (read-only)

A throwaway read script (`scripts/intuition-verify.ts`) that:

1. Pins a session to testnet (RPC, MultiVault, GraphQL, `getAtomCost`, `getTripleCost`,
   `getBondingCurveConfig` curveId).
2. Resolves whether predicates `owns`, `delegate to`, `is in context of` already exist
   on testnet (compute atom id from the pinned `ipfs://`/string URI, `isTermCreated`).
   Record their `term_id`s for reuse.
3. Confirms a nested-triple example is representable: build a sample
   `(CAIP-10 → delegate to → CAIP-10)` triple id, then a
   `(DelegationJson → is in context of → <that triple id>)` and confirm the object slot
   accepts a triple id (native, no flat fallback).

Output: a short note in the plan / ADR of which predicate term_ids exist on testnet.

## Phase 2 — Write service (pure, testable)

New module `src/lib/intuition/` (services layer per `rules/code.md`; no React imports):

- `network.ts` — viem chain defs (testnet/mainnet) + MultiVault addresses + read ABI.
- `multivault.ts` — read helpers: `getAtomCost`, `getTripleCost`, curveId,
  `calculateAtomId`, `calculateTripleId`, `isTermCreated`, `previewAtomCreate`,
  `previewTripleCreate`.
- `atoms.ts` — encode atom data by kind:
  - delegator wallet → `caip10:eip155:{chainId}:{address}` (CAIP-10, no IPFS).
  - recipient by kind: EOA/Safe/contract → CAIP-10; Intuition atom wallet →
    `Account Wallet` from `computeAtomWalletAddr(atomId)`.
  - `Organization` → `pinOrganization` (IPFS).
  - `DelegationJson` → reuse existing `meta.agreement.uri` CID (no re-pin).
  - predicates `owns` / `delegate to` / `is in context of` → `pinThing` (IPFS), reuse
    by `term_id`.
- `publish.ts` — the orchestration, given a `StoredDelegation`:
  1. resolve/create predicate atoms (dedupe by `term_id`).
  2. resolve/create party atoms (delegator CAIP-10, recipient by kind, org).
  3. create `DelegationJson` atom from the existing IPFS URI.
  4. create relationship triple `(delegator, delegate to, recipient)`.
  5. create ownership triple `(org, owns, delegator)`.
  6. create nested binding triple `(DelegationJson, is in context of, <relationship id>)`.
  - Each step: existence-check first (`isTermCreated`), `preview*` before write,
    simulate, broadcast via the attestor signer, then post-write verify
    (`isTermCreated` true on the precomputed id). Idempotent: re-running skips existing
    terms. Steady state per delegation ≈ 1 atom + up to 3 triples.
- Recipient-kind detection: derive from the `StoredDelegation` (EOA vs Safe vs atom
  wallet). Default EOA/Safe → CAIP-10; atom-wallet path explicit.

### Signing
Node-side viem `WalletClient` from `INTUITION_ATTESTOR_PK` on the selected Intuition
chain. The service returns the created `term_id`s. Exercised from a script
(`scripts/intuition-publish.ts`) and a unit test mocking the network boundary
(`test/unit/intuition.test.ts`) per `rules/code.md`.

## Verification
- `bun run build` (tsc) green; `bun test test/unit` for the encoding/idempotency logic.
- Manual: run `scripts/intuition-publish.ts` against testnet with a funded key, confirm
  the atoms/triples on the testnet explorer + a GraphQL read-back.
- No `any`, named exports, services free of React.

## Unblock item
Funded testnet attestor key (`INTUITION_ATTESTOR_PK`) with tTRUST for the live write
test. Encoding + idempotency logic can be built and unit-tested without it; the live
broadcast step is gated on the key being present.

## Out of scope (this task)
Query layer (Phase 3), showcase UI (Phase 4), browser signer endpoint, mainnet.
