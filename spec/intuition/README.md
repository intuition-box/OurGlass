# Spec — Store OurGlass delegations on Intuition (semantic graph + query layer)

Status: design / not started. Ontology diagram: [`ontology.png`](./ontology.png).

## Goal

Use Intuition itself as the **storage + semantic + query layer** for OurGlass
delegations, replacing the local-first `localStorage` model for *discovery*.

Three things this buys us:

1. **Storage** — each signed delegation is recorded on the Intuition graph (the
   agreement we already pin to IPFS becomes an atom).
2. **Semantics** — relationships are expressed as triples: an organization *owns*
   a wallet, that wallet *delegates to* a recipient, and the signed delegation
   *is in context of* that relationship. This is what later enables semantic
   delegation (e.g. "pay if report approved by ≥3 members").
3. **Query layer** — the Intuition GraphQL API returns the **active delegations
   for whoever is connected**, with no private backend. This feeds the
   Sablier-style real-delegation showcase (see `FUTURE.md`).

This is the "store caveats + delegations on Intuition" chantier referenced in
`FUTURE.md` (streaming section) and Tier 2 of `spec/plan-analytics.md`.

## Ontology

Per [`ontology.png`](./ontology.png), a delegation is modelled as a **nested
triple**:

```
(DelegationJson) —[is in context of]→ ( (CAIP:10 Account) —[delegate to]→ (Recipient) )
```

Plus the ownership edge from the nutshell:

```
(Organization) —[owns]→ (CAIP:10 Account)
```

### Why nested triples

Intuition triples link three **atoms**, but an atom slot may itself be a
**triple** ("nested triple"). So the object of `is in context of` is the whole
`(delegator, delegate to, recipient)` triple — the literal shape in the diagram.
No flat-triple fallback needed.

### Atoms

| Atom | Encoding | Notes |
|---|---|---|
| `CAIP:10 Account` (delegator wallet, e.g. the Safe) | `caip10:eip155:{chainId}:{address}` | Native CAIP-10, no IPFS. Deduped/content-addressed — reuse if it exists. |
| `Recipient` | varies by recipient type (below) | The delegate / payee. |
| `Organization` | `pinOrganization` → `ipfs://` | The org that owns the wallet. |
| `DelegationJson` | the agreement already pinned to IPFS by OurGlass | Reuse the existing CID; salt = `keccak256(terms)`. |
| Predicates `owns`, `delegate to`, `is in context of` | `pinThing` → `ipfs://` | Created once, reused by `term_id`. Resolve existing first. |

### Recipient types (CAIP:10 vs Account Wallet)

The `Recipient` object varies because OurGlass pays to different account kinds —
this is the `CAIP:10` vs `Account Wallet` distinction in the diagram:

- **EOA** → `CAIP:10 Account` atom.
- **Safe / any contract treasury** → `CAIP:10 Account` atom (the contract
  address).
- **Intuition atom wallet** → the `Account Wallet` derived from an atom
  (`computeAtomWalletAddr(atomId)`) — the composable, Intuition-native case.

All three are in scope; model the recipient atom by kind. (Row 1 of the diagram =
atom wallet; row 2 = plain CAIP-10.)

## Write flow (creating the graph entries for a delegation)

After a delegation is signed in OurGlass:

1. **Resolve / create predicate atoms** `owns`, `delegate to`, `is in context of`
   (pin via `pinThing`, reuse by `term_id` if already on the graph). One-time.
2. **Resolve / create the party atoms**: the delegator CAIP-10, the recipient
   atom (by kind), the organization (`pinOrganization`).
3. **Create the `DelegationJson` atom** from the existing IPFS agreement URI.
4. **Create the relationship triple** `(delegator, delegate to, recipient)`.
5. **Create the ownership triple** `(organization, owns, delegator)`.
6. **Create the nested binding triple**
   `(DelegationJson, is in context of, <relationship triple id>)`.

Each create is a $TRUST-payable tx on the Intuition L3. Atoms/predicates dedupe,
so steady-state per delegation is ~1 atom (DelegationJson) + up to 3 triples.

Always: check existence on-chain (`isTermCreated(calculateAtomId/TripleId)`),
`previewAtomCreate`/`previewTripleCreate` before writing, simulate, then verify
post-broadcast (per the intuition skill's safety invariants).

## Query layer (discovery by connected account)

Given the connected wallet → its CAIP-10 atom `term_id`, one GraphQL "atom → its
triples" query answers the product needs:

- **as_subject + predicate `delegate to`** = delegations this account **grants**
  (it is the payer/delegator).
- **as_object + predicate `delegate to`** = delegations this account
  **receives** = what it can **claim** (feeds the showcase claim lines).
- Traverse the nested `is in context of` triple → the `DelegationJson` atom →
  the pinned agreement (terms, rate, period) for display.
- `owns` triples resolve which org a wallet belongs to (the
  "from intuition.box for Mission 4" line).

No backend, no `localStorage` dependency for discovery.

## Active vs revoked — source of truth

Intuition triples persist even after an on-chain `disableDelegation`. So:

- **Intuition = discovery + semantics** (which delegations exist, their meaning).
- **Origin chain `DelegationManager` = source of truth** for enabled/revoked.

Flow: discover candidates on Intuition → confirm `enabled` on the origin chain
before showing "active / claimable". This mirrors the skill's own
discovery-vs-truth split. (Optional later: also signal revocation via the
triple's counter-triple for an on-graph hint — not the authority.)

## Open decisions (resolve before build)

1. **Who writes & pays the $TRUST?**
   - (a) **OurGlass funded attestor wallet** writes triples on the user's behalf
     — clean UX, but OurGlass is the attestor. (Matches the Tier 2 analytics
     assumption.)
   - (b) **Org's connected wallet** signs on Intuition too — self-sovereign,
     needs tTRUST/$TRUST + extra steps.
   - *Recommendation:* start with (a) for the demo, keep (b) as the
     decentralization path.
2. **Active/revoked** — confirm "chain is source of truth, Intuition is the
   index" (recommended) vs counter-triple signaling.
3. **Network** — build on **testnet (13579)**, prod on **mainnet (1155)**.
   *Recommendation:* testnet first.

## Decided

- Nested triples (literal diagram ontology), no flat fallback.
- Recipient types: EOA, Safe/contract treasury, Intuition atom wallet — all
  modelled.
- `DelegationJson` reuses the agreement OurGlass already pins to IPFS.

## Build phases

1. **Verify on the live graph** (read-only, Path A): confirm a nested triple
   example exists; resolve whether `owns` / `delegate to` / `is in context of`
   predicates already exist (reuse) — per network, since `term_id`s differ.
2. **Write path (service)** — a module that, given a signed OurGlass delegation,
   performs the create flow above on the chosen network with the chosen payer.
   Pure service, testable; follows the intuition skill operation files.
3. **Query path** — GraphQL client + hooks returning active delegations for the
   connected account (grants + claimable), cross-checked against the origin
   chain for enabled status.
4. **UI** — wire into the showcase (`FUTURE.md`), not `/analytics` (which stays
   metrics).

## References

- Intuition skill: `~/.claude/skills/intuition/` (atoms, triples, nested triples,
  GraphQL discovery, IPFS pinning, networks).
- `spec/plan-analytics.md` (Tier 2 — Intuition reputation graph).
- `FUTURE.md` — streaming "Stockage Intuition" + the real-delegation showcase.
