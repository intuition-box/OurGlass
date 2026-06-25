# OurGlass-owned enforcer instances on Ethereum mainnet

**Status:** Accepted
**Date:** 2026-06-25
**Triggered by:** user request (deploy factory + enforcers to Ethereum mainnet) + `spec/plan-analytics.md`

## Context

OurGlass has no contract of its own. A charge is a call to the shared
`DelegationManager` plus an ERC20 `Transfer`; the caveat enforcers are shared across
every app on the Delegation Framework, so nothing on-chain is attributable to
OurGlass. The app is local-first (delegations live in `localStorage`), so there is no
central registry of OurGlass delegations to filter analytics by. `plan-analytics.md`
identified the need for an OurGlass-attributable on-chain marker that needs no central
registry.

Separately, the `DeleGatorModuleFactory` is not a deterministic deployment and was
missing on Ethereum mainnet (chain 1) — `addresses.ts` carried the zero address, which
made Hybrid module setup fail with "Configuration needed".

## Decision

Deploy OurGlass-owned instances of three **unmodified, audited** MetaMask enforcers —
`ERC20PeriodTransferEnforcer`, `TimestampEnforcer`, `ERC20StreamingEnforcer` — via
CREATE2 under an OurGlass-specific salt (`OURGLASS`), plus the `DeleGatorModuleFactory`,
on Ethereum mainnet. The three enforcers are the full set referenced by OurGlass
delegations (subscription cap + end date; payroll stream). The period enforcer's
`TransferredInPeriod` events, filtered by emitter address, become the analytics marker.

This is **not** a custom enforcer: the deployed runtime bytecode is byte-identical to the
`@metamask/delegation-framework` artifacts (verified post-deploy, see below). The
deviation recorded is the *deployment under a new salt/address*, not any logic change.
Enforcers are not whitelisted by the `DelegationManager`, and the enforcer address is
part of the signed caveat, so a self-deployed instance interoperates with the canonical
manager with the security model unchanged.

### Deployed addresses (chain 1)

| Contract | Address | Verified |
|---|---|---|
| `DeleGatorModuleFactory` | `0xbDDe43bcF6db9DBeB1127e6574ccF70bFb1c2dc3` | wired to canonical DelegationManager |
| `ERC20PeriodTransferEnforcer` (marker) | `0x11262E3116a50654547AB0A417BE77eB14b9F339` | bytecode IDENTICAL to audited artifact |
| `TimestampEnforcer` | `0xF1635460548F44543366ec4453D512a7Ce85Af85` | bytecode IDENTICAL to audited artifact |
| `ERC20StreamingEnforcer` | `0xE475D14d61756D6e940B74C20d2E44EB70c71a8D` | bytecode IDENTICAL to audited artifact |

- Deployer: OWS `ourglass-deployer` wallet `0x2FF0363132d0dc5feb090790C46B77EF1ce96aa2`
  (key encrypted at rest in OWS; signed via `ows sign send-tx`, never exported).
- Salt: `bytes32(abi.encodePacked("OURGLASS"))` =
  `0x4f5552474c415353000000000000000000000000000000000000000000000000`.
- Deploy script: `delegation-framework/script/DeployOurGlassEnforcers.s.sol`.
- Cost: ~0.0005 ETH total (≈2.95M gas), at sub-gwei mainnet gas.

## Alternatives considered

- **Bespoke events-registry contract** — rejected: new logic to audit, charge-path
  change, extra gas. The audited-enforcer redeploy needs none of these.
- **Re-use the canonical shared enforcers** — rejected for the marker: their events are
  indistinguishable across every Delegation Framework app, defeating attribution.
- **Deploy only the period enforcer** (`plan-analytics.md` scope) — widened on user
  request to also include timestamp + streaming, so every OurGlass delegation type
  references an OurGlass-owned instance and mainnet operation does not depend on the
  canonical enforcers being present on L1.
- **Deploy the full 37-enforcer suite** (`DeployCaveatEnforcers.s.sol`) — rejected:
  ~28.3M gas for ~34 enforcers OurGlass never references.
- **Export the deployer key to forge `--broadcast`** — rejected in favour of OWS
  signing the prebuilt txs, so the raw key never leaves the encrypted vault.

## Consequences

**Positive:**
- New subscriptions routed to the OurGlass period enforcer are attributable on-chain by
  a single `WHERE contract_address = 0x11262E…` filter — no central registry.
- The mainnet factory gap is closed; Hybrid module setup works on chain 1.
- Security model unchanged: identical audited bytecode, signature covers the enforcer
  address.

**Negative:**
- One more deployment to track per chain (currently chain 1 only).
- Existing delegations reference the shared enforcer and stay un-attributed (acceptable;
  no re-signing).

**Neutral (worth knowing):**
- Routing new delegations to these instances requires overriding
  `caveatEnforcers` in `src/lib/environment.ts`, scoped to chains where `ourglass`
  addresses exist. Until that override ships, the instances are deployed but unused.
- The CREATE2 addresses above are deterministic from salt + bytecode and will be the
  same on any chain we later deploy to.

## References

- Related plan: `spec/plan-analytics.md`
- Related rule: `.claude/rules/metamask-delegation.md`, `.claude/rules/security.md`
- Config: `src/config/addresses.ts` (chain 1 `ourglass`)
- Deploy script: `delegation-framework/script/DeployOurGlassEnforcers.s.sol`
