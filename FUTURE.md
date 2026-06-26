# Future work

Deferred ideas captured during tasks (per workflow rules — scope discipline).

- **Multi-token redeem stats.** `StatsRow` / `sumDisplay` on the Charge page sum
  claimable/claimed across token groups under a single hardcoded "USDC" label.
  Correct for the current USDC-centric POC (amounts are grouped per token with
  per-token decimals in `useClaimTotals`), but if non-USDC redeem becomes real,
  show per-token figures and the actual symbol instead of a single USDC headline.
