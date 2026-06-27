# 0001 — Host the interactive redeem console in the Fumadocs website

**Status:** Accepted
**Date:** 2026-06-27
**Triggered by:** user request ("move the /safe-app/redeem page into the fumadoc")

## Context

The redeem console (`StandaloneRedeem`) is a public, wallet-driven page: a payee
loads a signed subscription/stream and redeems it on-chain. It previously lived in
the Vite Safe App under `/safe-app/redeem`, even though it is not a Safe-iframe
feature — it is a standalone tool any payee uses with their own wallet.

The website (`website/`, Next.js 16 + Fumadocs 16, **static export**) is the public
face of OurGlass and already owns the landing/docs/blog. The redeem page belongs
with the public site, not under the Safe App namespace.

## Decision

Port the redeem console into the website at `/redeem` (root), and remove it from
the Vite app. To do so:

1. Add the wallet stack to `website/package.json` (`wagmi`, `viem`,
   `@tanstack/react-query`, `@metamask/smart-accounts-kit`, `@number-flow/react`).
2. Integrate it into the Fumadocs chrome: the page lives in the `(home)` route
   group (so it inherits the `HomeLayout` navbar + footer + theme), and the wallet
   `WagmiProvider`/`QueryClientProvider` mount once at the `(home)` layout. The
   connect button is a custom navbar link; the per-page chain selector moved into
   the page body. The config uses `ssr: true` so the layout prerenders safely under
   static export, and the connect button gates on a `mounted` flag to avoid
   hydration mismatch — no `dynamic(ssr:false)` needed.
3. Port the dependency tree into a self-contained `website/src/redeem/` subtree
   (`config/`, `lib/`, `hooks/`, `ui/`), trimming each ported module to only the
   exports the console consumes.
4. Carry the OurGlass design tokens/utilities the page needs into the website's
   `global.css`, scoping form-field styling to `.og-redeem` so Fumadocs inputs are
   untouched.

## Alternatives considered

- **Leave it in the Vite app, keep `/safe-app/redeem`** — keeps one wallet stack,
  but buries a public tool under the Safe namespace and splits the public surface
  across two apps. Rejected per the user's request.
- **Server-render the page (drop static export)** — would let it live as a normal
  Next route, but breaks the single-process Caddy/Coolify container model the site
  was built for. Static export + client-only mount preserves it.
- **Extract the on-chain calls in `handleRedeem` into a `useRedeem` hook/service
  (full `code.md` layering compliance)** — correct in isolation, but this task is a
  *move* of an already-reviewed page, and the same component-level chain-call
  pattern still exists in the Safe App's `Charge.tsx`. Refactoring only the website
  copy would diverge the two and expand scope on the one critical (redeem) path.
  Deferred — see Consequences.

## Consequences

**Positive:**
- The public redeem tool lives with the public site at a clean `/redeem` URL.
- Single source for the redeem flow; the Vite app sheds the route and its dead
  `redeemSubscriptionDirect` export.
- Static export and the Coolify container model are unchanged.

**Negative:**
- The website now ships a second, large dependency stack (wagmi/viem/SDK).
- `StandaloneRedeem.tsx` still instantiates a `publicClient` and calls the chain
  directly inside the component — a known deviation from `code.md` (a component
  must not call the chain directly). Accepted as a faithful port; the read path is
  already correctly behind `useClaimState`. Revisit by extracting a `useRedeem`
  hook in a dedicated refactor that also covers `Charge.tsx`.

**Neutral (worth knowing):**
- The ported `redeem/` subtree duplicates a few shared modules from `src/lib`.
  Kept intentionally self-contained; reconcile if/when the apps are reorganized.

## References

- Related rule: `.claude/rules/code.md` (layering), `.claude/rules/ui.md`
- Related plan: `plan-fumadocs-website.md`
