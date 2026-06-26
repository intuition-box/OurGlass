import { formatUnits } from 'viem'
import { type ClaimView } from '../hooks/useClaimState'

// Display helper: at most 2 decimals, dot separator, trailing zeros trimmed.
function fmtAmount(raw: bigint, decimals: number): string {
  const [int, frac = ''] = formatUnits(raw, decimals).split('.')
  const f = frac.slice(0, 2).replace(/0+$/, '')
  return f ? `${int}.${f}` : int
}

function Stat({ label, value, sym, tint }: { label: string; value: string; sym: string; tint: string }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-faint uppercase tracking-wide">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tint }} /> {label}
      </div>
      <div className="font-mono font-bold text-ink tnum mt-1 leading-none">
        {value}{sym && <span className="text-dim text-[11px] font-semibold"> {sym}</span>}
      </div>
    </div>
  )
}

/**
 * Claimed / claimable / cap for a delegation, read from the caveat enforcer
 * (on-chain) or estimated from the signed terms before a stream's first claim.
 * Shared by the in-Safe Charge page and the standalone biller redeem console.
 */
export function ClaimProgress({ view, symbol }: { view: ClaimView; symbol: string }) {
  if (view.loading) return <div className="mt-5 text-xs text-faint">Reading on-chain state…</div>
  if (view.error) return <div className="mt-5 text-xs text-danger">Could not read on-chain state: {view.error}</div>
  if (!view.scope) return null
  const { claimed, claimable, cap, decimals, onChain, scope } = view
  const period = scope === 'subscription'
  const pct = (v: bigint) => (cap && cap > 0n ? Math.min(100, Number((v * 10000n) / cap) / 100) : 0)
  return (
    <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-faint uppercase tracking-wide">{period ? 'This period' : 'Stream progress'}</span>
        <span className="text-[10px] text-faint">{onChain ? 'on-chain' : 'estimated'}</span>
      </div>
      {cap !== null && (
        <div
          className="mt-3 h-2 rounded-full overflow-hidden flex"
          style={{ background: 'var(--line, rgba(255,255,255,.08))' }}
          role="progressbar"
          aria-label={period ? 'Claimed and claimable against the period cap' : 'Claimed and claimable against the stream cap'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct(claimed) + pct(claimable))}
        >
          <div style={{ width: `${pct(claimed)}%`, background: 'var(--accent)' }} />
          <div style={{ width: `${pct(claimable)}%`, background: '#22D3EE' }} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Claimed" value={fmtAmount(claimed, decimals)} sym={symbol} tint="var(--accent)" />
        <Stat label="Claimable now" value={fmtAmount(claimable, decimals)} sym={symbol} tint="#22D3EE" />
        <Stat label={cap !== null ? (period ? 'Period cap' : 'Cap') : 'Unbounded'} value={cap !== null ? fmtAmount(cap, decimals) : '∞'} sym={cap !== null ? symbol : ''} tint="#6b7280" />
      </div>
    </div>
  )
}
