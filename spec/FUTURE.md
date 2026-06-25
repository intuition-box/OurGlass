# FUTURE — ideas out of scope for the current POC

Ideas captured for consideration, not yet committed. An idea only becomes a task
on an explicit decision (see `.claude/rules/workflow.md`).

## Streaming payment — accumulating payroll (2026-06-23)

**Target:** add a new OurGlass page dedicated to *payment streaming*, alongside
the existing subscription system.

**Caveat to use:** `erc20Streaming` from the Delegation Toolkit.
https://docs.metamask.io/smart-accounts-kit/reference/delegation/caveats#erc20streaming

### The need: two distinct systems, two audiences

**System 1 — service subscription (what exists today)**
- A cap *per period* (monthly), via the `erc20PeriodTransfer` caveat.
- Must be claimed *each period*; it **does not accumulate**.
- The non-accumulation is a *choice*: for a DAO paying for a service, it avoids
  letting an unclaimed balance pile up if someone forgets to claim.
- Audience: DAO ↔ service.
- Accepted consequence: if a period isn't claimed, it's lost (use-it-or-lose-it).

**System 2 — accumulating payroll (new, to build)**
- The payment **accumulates continuously** (linear stream), via `erc20Streaming`.
- The beneficiary claims whenever they want; nothing is lost if they don't claim
  immediately.
- Audience: contributor / employee (payroll).
- Key motivation: if the beneficiary is prevented from claiming (e.g. accident,
  unavailability), with System 1 that would be a **dead loss**; with System 2 the
  due amount accumulates and stays claimable → no loss.

### Design distinction to keep
- System 1 = non-cumulative periodic cap (service, DAO).
- System 2 = cumulative stream bounded by a cap (payroll, contributor).
- Both coexist in OurGlass as two distinct flows/pages.

### Claimable amount — decided strategy (2026-06-24)
- **POC (now):** don't overthink the precise claimable computation. Rely on the
  **timestamp already present in the agreement pinned to IPFS** (the terms'
  startDate) to estimate the elapsed range. Client-side estimate, good enough for
  the demo. No on-chain tracking of the already-claimed amount for now.
- **Later:** store the **caveats + delegations on Intuition** → a **traversable
  graph** with timestamps → **precise time ranges** to compute exactly the
  available/claimed amounts. This replaces the IPFS estimate and makes the
  computation reliable (including when claims come from multiple sources).
- **Safeguard:** the client-side estimate is only UX. The `erc20Streaming` caveat
  knows *exactly* how much is unlocked and enforces it on-chain. A wrong estimate
  can't cause an over-withdrawal: at worst an over-optimistic claim **reverts**.
  Security never depends on our estimate.

### To investigate (open questions)
- Exact parameters of the `erc20Streaming` caveat: confirmed —
  `tokenAddress`, `initialAmount`, `maxAmount`, `amountPerSecond`, `startTime`.
- Task split between the 2 devs: drafted (Dev A = creation + streaming core +
  owner storage; Dev B = claim + UI separation + home + owner redeem).
- An upstream choice screen (2 cards Subscription/Stream) is recommended, then
  two dedicated forms.
- **Intuition storage (caveats + delegations as a graph)** — the next chantier
  after streaming; unlocks the precise amount computation. See
  [`intuition/README.md`](./intuition/README.md).

## Showcase "real delegations" — Sablier-style window (2026-06-24)

**Target:** a product showcase that displays **real, live delegations** with
**real on-chain data** — in the style of `app.sablier.com/vesting/stream/...`: a
visual simulation of the stream / the redeem, plus readable lines like *"Pixi has
257.45 USDC to claim on his $300/month delegation from intuition.box for Mission 4
— Social Media. Last claim 22 days ago."* Possibly a "recent payouts" feed (like a
sports-betting ticker).

**Placement (decided):** NOT on `/analytics`. The `/analytics` page stays
unchanged = **aggregate metrics** (charge count, volume, breakdowns), "coming
soon". The showcase lives elsewhere: a **landing section** or a **dedicated page
reached via a "demo" button on the landing**. Two distinct surfaces:
`/analytics` (metrics) vs demo/showcase (live individual delegations).

**Dependency:** requires delegations to be **published on Intuition** (traversable
graph + timestamps, cf. the streaming section above). Until that's in place, the
showcase has no real data to display — so we **don't ship the button/page yet**
(risk of an empty screen). To build once Intuition storage is ready.

**Product argument (positioning vs Sablier):** no custom contract, no treasury
split, MetaMask-audited enforcers, more transparency + control, public good,
100% open-source, no forced payment.

**Future extension:** semantic delegation via Intuition (e.g. "pay this
contributor if their report is approved by ≥ 3 team members") — OurGlass is the
neutral facilitator, each team encodes its own payment logic. Tied to the
enforcer-registry mission/partnership (funded by intuition.box).
