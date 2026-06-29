# 0003 — Intuition testnet: predicate reuse + nested-triple verification

**Status:** Accepted
**Date:** 2026-06-28
**Triggered by:** Phase 1 (read-only verify) of `spec/intuition/README.md` — "store OurGlass delegations on Intuition".

## Context

Before building the write path, the spec requires verifying on the live graph
(per network, `term_id`s differ): (a) whether the predicates `owns`,
`delegate to`, `is in context of` already exist (reuse vs create), and (b) that a
nested triple — object slot holding a triple — is representable, since the
ontology models a delegation as
`(DelegationJson —is in context of→ (delegator —delegate to→ recipient))`.

Verified read-only against Intuition **testnet (13579)**, MultiVault
`0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91`, GraphQL
`https://testnet.intuition.sh/v1/graphql`.

Session constants (testnet, this date): `getAtomCost` = `1000000001000000` wei
(~1e15), `getTripleCost` = `1000000002000000` wei (~1e15), default `curveId` = 1.
Costs are governance-configurable — re-read before any write batch.

## Findings (testnet predicate vocabulary)

| Predicate (spec label) | Status on testnet | term_id | Notes |
|---|---|---|---|
| `owns` | **Exists** (reuse) | `0xdd3eb9326e013e0ffecb067709bbf6cb6352122e025faede9c887b7c9ac4b773` | `Thing`, used as predicate in 5 triples. A duplicate `0x76a965…` (asPred 0) also exists — ignore it; resolve by term_id. |
| `delegate to` | **Absent** (must create) | — | Only a legacy unused `delegate` (`TextObject`, `0x78e812…`, asPred 0) and unrelated "Delegate Labs" exist. The exact `delegate to` predicate must be pinned + created. |
| `is in context of` | **Absent as-is**; close established variant `in context of` exists | `in context of` = `0x61a88b9c372c0d164d2caf66947b67ed0fcb4c457178a271b6b3dc39fb1f8862` | `in context of` is a `Thing` predicate used in 11 triples. Exact `is in context of` not found. Decision pending (see below). |

## Decision

1. **Reuse `owns`** = `0xdd3eb9…` (established `Thing`, 5 uses). Resolve by term_id,
   not label (a duplicate shares the label).
2. **Create `delegate to`** — absent; pin via `pinThing` and create the atom.
3. **`is in context of` vs `in context of` — deferred to the user before Phase 2.**
   Reuse the established `in context of` (`0x61a88b…`, 11 uses, aligns with graph
   vocabulary, saves an atom create) vs create the exact spec label `is in context of`
   (matches the ontology diagram verbatim, fresh atom). Recommendation: **reuse
   `in context of`** — it is the same semantic and already established on testnet.
4. **Nested triples are native — no flat fallback.** Confirmed on testnet: the
   `in context of` triples nest on the subject side, e.g.
   `( 0xE596… —visits for learning→ arxiv.org/abs/2305.13245 ) —in context of→ Science`.
   The subject `term_id` resolves via `triple(term_id:)` and is `null` under the
   `atom(term_id:)` query — proving the term-id space is shared between atoms and
   triples, and a triple is a valid slot in another triple. `createTriples` takes
   symmetric `bytes32` slots, so object-side nesting (our shape) works identically.

## Mainnet predicates (verified 2026-06-29, read-only)

Provisioned for prod on Intuition mainnet (1155), MultiVault
`0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e`. atomCost/tripleCost ≈ 1e17 wei
(100× testnet). The attestor is funded with $TRUST.

| Predicate | term_id | Status |
|---|---|---|
| `owns` | `0xdd3eb9326e013e0ffecb067709bbf6cb6352122e025faede9c887b7c9ac4b773` | Reuse — established `Thing` (also the testnet id; atom id is deterministic from data). |
| `in context of` | `0x892054b01d389bfe566166120470f572a56e3d4cd88c599b52c4708949625390` | Reuse — canonical `Thing`, 999 uses (distinct from the testnet id). |
| `delegate to` | `0xb56980d42a3b03455bf41ea20fe04ae223fca0b9e688994dc661414e81e6433b` | Create on first publish — not yet on mainnet. Its id is `calculateAtomId` of our fixed pin payload, which is **chain-independent**, so it equals the testnet id. |

These ids are wired into both the write config (`src/lib/intuition/network.ts`) and
the read configs (`src/lib/intuition/discover.ts`, `organizations.ts`, and the
website `redeem/lib/intuition/network.ts`). `delegate to` is created (paid in
$TRUST) on the first mainnet publish; discovery finds nothing on mainnet until
then, which is correct (no triples reference it yet).

## Detection note (for the Phase 3 query layer)

GraphQL resolves a `subject`/`object` relation to `null` when that slot holds a
triple (the relation joins the atoms table). To traverse a nested triple, read the
raw `subject_id` / `object_id` and re-query `triple(term_id: <slot_id>)`.

## Alternatives considered

- **Create all three predicates fresh** — rejected for `owns` (already established;
  creating a duplicate fragments the vocabulary and wastes $TRUST).
- **Assume nested triples need a flat fallback** — rejected; verified native on-chain.

## Consequences

**Positive:**
- Steady-state per delegation is minimal: reuse `owns` (and likely `in context of`),
  create `delegate to` once, then ~1 atom (`DelegationJson`) + up to 3 triples each.
- Nested ontology builds verbatim from the diagram.

**Negative:**
- One open decision (`is in context of` vs `in context of`) blocks the exact predicate
  set for Phase 2.

**Neutral:**
- term_ids are testnet-specific; mainnet (1155) must be re-verified before a prod write.

## References

- Spec: `spec/intuition/README.md`, `spec/intuition/ontology.png`
- Plan: `plan-intuition-storage.md`
- Skill: `~/.claude/skills/intuition/reference/{network-config,graphql-queries,reading-state}.md`
