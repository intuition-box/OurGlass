# 0002 — Analytics page reads enforcer logs client-side (no backend, no subgraph yet)

**Status:** Accepted
**Date:** 2026-06-27
**Triggered by:** user request ("implement the analytics page", per `spec/plan-analytics.md`)

## Context

`spec/plan-analytics.md` defines OurGlass analytics as attribution by **emitter
address**: route charges through OurGlass's own (audited-bytecode) enforcer
instances and index their events. The OurGlass `ERC20PeriodTransferEnforcer` and
`ERC20StreamingEnforcer` instances are already deployed on Ethereum mainnet
(`src/config/addresses.ts` → chain 1 `ourglass`). The spec names a The Graph
subgraph as the primary indexer, but no subgraph is deployed, and the website is a
**static export** with no backend.

## Decision

Ship the `/analytics` page as a **client-side dashboard** that reads the enforcer
instances' events directly via `eth_getLogs` (viem), decodes them in the browser,
and derives the metrics (count, per-token volume, over-time, per-receiver,
per-agreement). It runs entirely client-side under static export (a `dynamic(…,
{ ssr:false })` mount), so nothing runs at build time.

Per-charge amounts follow the event semantics confirmed against
`@metamask/delegation-abis`:
- subscriptions (`TransferredInPeriod`): in-period delta of
  `transferredInCurrentPeriod`, with period boundaries detected from
  `(startDate, periodDuration, transferTimestamp)` so a new period's first charge
  is counted in full;
- streams (`IncreasedSpentMap`): delta of the lifetime-cumulative `spent`.

The log scan covers a bounded recent block window with adaptive chunk-halving so
it degrades gracefully against provider range/result caps.

## Alternatives considered

- **Deploy a The Graph subgraph (spec's primary)** — the right answer at scale and
  for unbounded history, but it is infra to stand up and operate, and the spec's
  data model is identical either way. Deferred as the drop-in upgrade behind the
  same UI.
- **Keep the "coming soon" placeholder** — rejected; the on-chain marker exists,
  so a real read is shippable now.
- **A private indexing backend** — rejected; violates the no-backend posture and
  the static-export container model.

## Consequences

**Positive:**
- A working, verifiable analytics page now, with zero backend and no subgraph.
- Faithful to the spec's attribution-by-emitter model; swapping in a subgraph
  later is a data-source change behind the same components.

**Negative:**
- The browser scan only covers a bounded recent block window (`LOOKBACK_BLOCKS`);
  it is not a full-history index. Acceptable given the instances deployed days ago.
- Each page load issues several `eth_getLogs` calls to a public RPC. The RPC must
  serve historical logs without a key (publicnode gates these behind an archive
  token), so the default is Tenderly's public gateway; override via
  `NEXT_PUBLIC_ANALYTICS_RPC_URL` (e.g. a keyed Alchemy endpoint) for headroom.
- No website unit-test runner exists, so the pure aggregation/delta functions ship
  without automated tests (kept pure and isolated for a later harness).

**Neutral (worth knowing):**
- Only charges routed to the OurGlass enforcer instances are attributable; older
  delegations on the shared enforcer stay un-attributed (matches the spec).
- `viem` is added to `website/package.json` (also added by the redeem PR; dedupes on merge).

## References

- Related spec: `spec/plan-analytics.md`
- Related doc: `website/content/docs/analytics.mdx`
- Related rule: `.claude/rules/metamask-delegation.md`, `.claude/rules/code.md`
- Related ADR: `.claude/choices/0001-redeem-page-on-website.md`
