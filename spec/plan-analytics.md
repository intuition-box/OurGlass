# Plan — On-chain analytics for OurGlass

## Goal

A decentralized, verifiable analytics surface for OurGlass: **transaction count and
token volume over time**, broken down by subscription / payee / subscriber / token —
queryable from public on-chain data, no private backend required.

## The attribution problem (why this is non-trivial)

OurGlass has no contract of its own today. A charge is a call to the *shared*
`DelegationManager` plus a plain ERC20 `Transfer`. Nothing on-chain says "OurGlass":
the enforcer addresses are shared across every app on the Delegation Framework, the
delegate/delegator vary per subscription, and the salt is unguessable. And because the
app is local-first (delegations live in `localStorage`), there is no central list of
OurGlass delegation hashes to filter by. Every analytics approach reduces to one
question: **how do we plant an OurGlass-attributable marker on-chain that needs no
central registry?**

## Chosen approach — redeploy the audited period enforcer as the marker

Deploy OurGlass's **own instance of MetaMask's audited `ERC20PeriodTransferEnforcer`**
(unmodified bytecode), and route new subscription delegations to that instance instead
of the shared one. Then index that contract's events.

Why this is the right marker:

- Enforcers are **not whitelisted** by the `DelegationManager` — a caveat may name any
  `CaveatEnforcer` address, so a self-deployed instance interoperates with the
  canonical manager. Security model is unchanged: identical audited logic, different
  address. The enforcer address is part of the signed caveat, so the signature covers
  it (no tampering).
- The enforcer **emits an event on every gated transfer**, and the event's *emitter
  address is our enforcer*. Attribution becomes a one-key filter:
  `WHERE contract_address = <our enforcer>` — **no central list of delegation hashes
  needed.** This is what makes it work in the local-first model.
- It needs **no custom contract logic** (redeploy of audited bytecode), **no charge-
  path changes**, and **no extra gas** (the event fires regardless). It covers **all**
  subscriptions routed to it, not just fee opt-ins.

This supersedes an earlier idea of writing a bespoke events-registry contract, and it
is independent of the fee-collector work (`plan-fee-collector.md`).

## The on-chain trace (verified against `@metamask/delegation-abis`)

Two events carry everything we need. Both are emitted today by the canonical
contracts; routing to our enforcer instance just makes #2 filterable by address.

**1. `DelegationManager.RedeemedDelegation`** — once per redemption:
```
RedeemedDelegation(indexed address rootDelegator, indexed address redeemer, tuple delegation)
```
- `rootDelegator` (indexed) = subscriber's DeleGator module
- `redeemer` (indexed) = payee (the delegate)
- `delegation` = full struct, incl. `caveats[]` (enforcer addresses + terms) and
  `salt` (= our `termsHash`, binding to the pinned IPFS agreement)

**2. `ERC20PeriodTransferEnforcer.TransferredInPeriod`** — once per charge (primary
data source):
```
TransferredInPeriod(
  indexed address sender,
  indexed address redeemer,
  indexed bytes32 delegationHash,
  address token,
  uint256 periodAmount,
  uint256 periodDuration,
  uint256 startDate,
  uint256 transferredInCurrentPeriod,
  uint256 transferTimestamp)
```
From this single event, filtered by our enforcer address, we derive the entire
dashboard — no joins required:

| Metric | Derivation |
|---|---|
| Charge count | count of events |
| Charge amount | delta of `transferredInCurrentPeriod` vs the prior event for the same `delegationHash` in the period (resets each period) |
| Volume over time | sum of charge amounts, bucketed by `transferTimestamp` |
| Per subscription | group by `delegationHash` |
| Per payee | group by `redeemer` |
| Per subscriber | `sender` (the funding account) and/or join `delegationHash` → `RedeemedDelegation.rootDelegator` |
| Per token | `token` |
| Active subscriptions | distinct `delegationHash` with a charge in window; cross-ref `DisabledDelegation` for revokes |

## Architecture

Three pieces. Only the first is new on-chain; the rest is off-chain indexing.

### 1. Deploy the audited enforcer instance (per chain)

- Source of truth: the `ERC20PeriodTransferEnforcer` artifact in
  `@metamask/delegation-abis` (the package ships `abi` **and** `bytecode`). Deploy the
  unmodified bytecode.
- Deploy on each operating chain: Base Sepolia (84532), Eth Sepolia (11155111), Base
  Mainnet (8453).
- Record the deployed addresses in `src/config/addresses.ts` (new field, e.g.
  `ourglassErc20PeriodTransferEnforcer` per chain).

### 2. Route new delegations to it (web app)

- Override the SDK environment so the period enforcer resolves to our instance. The
  environment is a plain address map: `env.caveatEnforcers.ERC20PeriodTransferEnforcer`
  (confirmed via `getSmartAccountsEnvironment`).
- Change is localized to `src/lib/environment.ts`: return
  `{ ...env, caveatEnforcers: { ...env.caveatEnforcers, ERC20PeriodTransferEnforcer: OURS } }`.
- `createDelegation` (in `src/pages/CreateDelegation.tsx`) already consumes this
  environment, so the signed caveat will name our enforcer with no further change.
- Redemption (`src/lib/redeemDirect.ts`) is unchanged — it calls whatever enforcer the
  signed caveat names.

### 3. Index + dashboard

- **Primary: a The Graph subgraph** keyed on `TransferredInPeriod` from our enforcer
  address (+ `RedeemedDelegation` / `DisabledDelegation` from the DelegationManager,
  filtered to our enforcer's delegations for subscriber mapping and revoke status).
  Works on testnets and is the decentralized-friendly indexer.
- **Secondary: a Dune dashboard** once on Base Mainnet (Dune testnet coverage is thin).
  Same event, decoded, filtered by contract address.
- The OurGlass UI's own analytics view (if wanted) reads the subgraph via GraphQL — no
  private backend, no `localStorage` dependency.

## Tiers (ship incrementally)

- **Tier 0 — fee-collector marker (free, from `plan-fee-collector.md`).** Inbound
  transfers to the fixed fee-collector address = opted-in charge count. Ships with the
  fee feature; partial coverage (opted-in only), count not volume.
- **Tier 1 — enforcer redeploy + subgraph/Dune (this plan, primary).** Full volume +
  count + breakdowns, all subscriptions, no central registry. Recommended core.
- **Tier 2 — Intuition reputation graph (optional, on-brand).** Publish one Intuition
  triple per subscription for a composable, public, conviction-weighted graph. See
  schema below. Separate-chain integration; heavier; its own ADR.

### Tier 2 schema (if pursued)

On the Intuition L3, written by an OurGlass attestation process (funded $TRUST wallet):
```
Atom  O = OurGlass            (IPFS-pinned: name, url)
Atom  P = payee/merchant      (CAIP-10 of payee address)
Atom  S = subscriber          (CAIP-10 of Safe address)
Atom  X = subscription        (IPFS-pinned, keyed by termsHash — unique per agreement)
Predicates: "subscribesVia", "subscribesTo" (pinned / canonical)

Triples:  (X, subscribesVia, O)      attribution to OurGlass
          (S, subscribesTo,  P)      relationship, queryable per merchant
```
Counts come from the public Intuition GraphQL indexer (active relationships, unique
subscribers, merchants). Good for the relationship/reputation layer — **not** for
high-frequency per-charge volume (triples dedupe; per-charge atoms cost $TRUST each).
Use Tier 1 for metrics, Tier 2 for the graph.

## Files to touch (Tier 1)

| File | Change |
|---|---|
| `src/config/addresses.ts` | Add `ourglassErc20PeriodTransferEnforcer` per chain |
| `src/lib/environment.ts` | Override `caveatEnforcers.ERC20PeriodTransferEnforcer` with our instance |
| `scripts/deploy-enforcer.mjs` (new) | Deploy the audited bytecode per chain; print + verify addresses |
| `subgraph/` (new) | The Graph manifest + handlers for `TransferredInPeriod` / `RedeemedDelegation` / `DisabledDelegation` |
| `.claude/choices/NNNN-redeploy-audited-enforcer.md` (new) | ADR (stub below) |

## Decisions (with recommendations)

1. **Marker mechanism — redeploy the audited enforcer (recommended)** vs. a bespoke
   events-registry contract. Redeploy wins: no new logic to audit, no charge-path
   change, no gas overhead.
2. **Indexer — The Graph subgraph (recommended)** as the portable, testnet-capable,
   decentralized-leaning core; add a Dune dashboard on mainnet for sharing.
3. **Scope — period enforcer only.** Every charge hits it, so routing just
   `ERC20PeriodTransferEnforcer` captures 100% of charges. No need to redeploy the
   timestamp enforcer.
4. **Migration — new subscriptions only.** Existing delegations reference the shared
   enforcer and stay un-attributed. Acceptable for a POC; no re-signing.

## Risks / caveats

- **Bytecode integrity.** The whole security argument rests on the deployed code being
  byte-identical to MetaMask's audited release. The ADR + `contract-reviewer` must
  verify this (see ADR stub). Pin the exact `@metamask/delegation-abis` version.
- **Constructor args / immutables.** Confirm the enforcer's constructor (if any) and
  that our deployment matches the canonical configuration.
- **`sender` semantics.** `TransferredInPeriod.sender` indexing — confirm whether it is
  the delegator (subscriber) or the DelegationManager. Either way `delegationHash` +
  `RedeemedDelegation.rootDelegator` reliably yields the subscriber; do not assume.
- **Per-charge amount via deltas.** `transferredInCurrentPeriod` is cumulative and
  resets each period — compute charge amount as the in-period delta, handle the
  period-boundary reset.
- **Dune testnets.** Limited; rely on the subgraph for testnet, Dune for mainnet.

## ADR stub — redeploy audited ERC20PeriodTransferEnforcer

> **Context.** OurGlass needs on-chain attribution for analytics. The shared enforcer
> is indistinguishable across apps and the app is local-first (no central delegation
> registry).
>
> **Decision.** Deploy an unmodified instance of MetaMask's audited
> `ERC20PeriodTransferEnforcer` and route new delegations to it, so its
> `TransferredInPeriod` events are attributable by emitter address.
>
> **Why this is not a "custom enforcer."** The repo rule forbids *writing* custom
> caveat enforcers. This deploys audited bytecode unchanged — same logic, new address.
> The deviation being recorded is the *deployment*, not a logic change.
>
> **Verification required (contract-reviewer).** Deployed runtime bytecode ==
> `@metamask/delegation-abis` artifact for the pinned version; constructor args match
> canonical; no source edits; the signed caveat correctly references the new address.
>
> **Consequences.** New subscriptions are attributable; existing ones are not. One
> deployment to maintain per chain.

## Verification (per `.claude/rules/workflow.md`)

1. `bun run typecheck`, `bun run build`.
2. Deploy on Base Sepolia; create a subscription (must reference our enforcer in the
   signed caveat — assert the address); charge it; confirm a `TransferredInPeriod` log
   from our address with the right `token`/amount/`delegationHash`.
3. Charge across two periods; confirm the subgraph reconstructs count + volume +
   per-period deltas correctly.
4. `contract-reviewer` agent on the deployment (bytecode-equivalence focus, per ADR).
5. `ui-reviewer` if an in-app analytics view is added.

## Scope note

Tier 1 deploys audited bytecode unchanged and changes one address-resolution line plus
adds off-chain indexing — no new contract logic, no charge-path change. It is a
deliberate, ADR-recorded deployment decision, not a protocol change. Tier 2 (Intuition)
is a larger, separate decision with its own ADR.
