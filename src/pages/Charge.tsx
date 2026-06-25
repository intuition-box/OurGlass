import { useEffect, useMemo, useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, isAddress, erc20Abi, formatUnits, BaseError, type Address } from 'viem'
import { getDelegations, type StoredDelegation } from '../lib/storage'
import { buildRedeemTx } from '../lib/redeemDirect'
import { useClaimState, type ClaimView } from '../hooks/useClaimState'
import { Card, Btn, StatusBadge, Payee, Mono, USDC } from '../ui/components'
import { IconBolt, IconCheck, IconLock, IconArrowL, IconRepeat } from '../ui/icons'
import { findChain, rpcUrl } from '../config/supported-chains'

const isStream = (d: StoredDelegation) => d.meta.scopeType === 'erc20Streaming'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const tintFor = (addr: string) => {
  const palette = ['#3B82F6', '#22D3EE', '#8B5CF6', '#34D399', '#FB7185', '#FBBF24']
  let h = 0
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

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

// Claimed / claimable / cap for a delegation, read from the caveat enforcer
// (on-chain) or estimated from the signed terms before a stream's first claim.
function ClaimProgress({ view, symbol }: { view: ClaimView; symbol: string }) {
  if (view.loading) return <div className="mt-5 text-xs text-faint">Reading on-chain state…</div>
  if (view.error) return <div className="mt-5 text-xs text-danger">Could not read on-chain state: {view.error}</div>
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

export default function Charge() {
  const { sdk, safe } = useSafeAppsSDK()
  const [selected, setSelected] = useState<StoredDelegation | null>(null)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [charging, setCharging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [safeTxHash, setSafeTxHash] = useState<string | null>(null)
  const [amountEdited, setAmountEdited] = useState(false)

  // Claimed / claimable / cap for the selected delegation, read from the caveat
  // enforcer (stream lifetime cap, or subscription per-period cap).
  const claim = useClaimState(selected)

  // This Safe can only redeem delegations where it is the delegate (payee) —
  // both per-period subscriptions and accumulating streams.
  const subs = useMemo(
    () =>
      getDelegations().filter(
        (d) =>
          d.delegation.delegate.toLowerCase() === safe.safeAddress.toLowerCase() &&
          (d.meta.scopeType === 'erc20SpendingLimit' || d.meta.scopeType === 'erc20Streaming') &&
          d.meta.status === 'signed',
      ),
    [safe.safeAddress],
  )

  function pick(d: StoredDelegation) {
    setSelected(d)
    // Seed with the period cap for subscriptions; the effect below overrides with
    // the claimable balance once the on-chain state resolves.
    setAmount(isStream(d) ? '' : d.meta.amount ?? '')
    setAmountEdited(false)
    setRecipient(d.meta.recipient ?? '')
    setError(null)
    setSafeTxHash(null)
  }

  // Pre-fill the claim amount with the claimable balance, until the user edits it.
  // The caveat caps the actual claim on-chain regardless.
  useEffect(() => {
    if (!selected || claim.loading || claim.error || amountEdited) return
    setAmount(formatUnits(claim.claimable, claim.decimals))
  }, [selected, claim.claimable, claim.decimals, claim.loading, claim.error, amountEdited])

  async function handleCharge() {
    if (!selected) return
    if (!isAddress(recipient)) {
      setError('Enter a valid recipient address (where the funds are paid).')
      return
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter an amount to charge.')
      return
    }
    setCharging(true)
    setError(null)
    try {
      const chain = findChain(safe.chainId)
      if (!chain) throw new Error(`Unsupported chain: ${safe.chainId}`)
      const client = createPublicClient({ chain, transport: http(rpcUrl(safe.chainId)) })
      const tokenAddress = selected.meta.tokenAddress
      if (!tokenAddress) throw new Error('Subscription has no token address')
      let decimals = 6
      try {
        decimals = await client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' })
      } catch {
        // default to USDC decimals
      }
      const tx = buildRedeemTx({
        chainId: safe.chainId,
        delegation: selected.delegation,
        token: { address: tokenAddress, decimals },
        amount,
        recipient: recipient as Address,
      })
      // Pre-flight: the Safe wraps any inner revert as opaque GS013. Simulate the
      // redeem from the Safe (msg.sender == delegate) first to surface the real
      // reason (caveat already charged this period, transfer-amount-exceeded,
      // insufficient balance, delegate mismatch) before proposing a doomed tx.
      try {
        await client.call({ account: safe.safeAddress as Address, to: tx.to, data: tx.data })
      } catch (sim) {
        const reason = sim instanceof BaseError ? sim.shortMessage : sim instanceof Error ? sim.message : String(sim)
        throw new Error(`Redeem would revert on-chain: ${reason}`)
      }
      const res = await sdk.txs.send({ txs: [{ to: tx.to, value: tx.value, data: tx.data }] })
      setSafeTxHash(res.safeTxHash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  // Success — the redeem is proposed to the Safe; owners confirm/execute it.
  if (safeTxHash && selected) {
    return (
      <div className="rise max-w-xl">
        <Card className="p-6 text-center">
          <div className="grid place-items-center w-12 h-12 rounded-2xl mx-auto" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}>
            <IconCheck size={24} />
          </div>
          <h2 className="text-lg font-bold text-ink mt-4">Charge submitted</h2>
          <p className="text-sm text-dim mt-1">{amount} {selected.meta.tokenAddress ? 'USDC' : ''} redeem proposed to the Safe. Confirm and execute it in the Safe to settle on-chain.</p>
          <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 text-left">
            <div className="flex items-center justify-between"><span className="text-xs text-faint">Recipient</span><Mono className="text-xs text-dim">{short(recipient)}</Mono></div>
            <div className="flex items-center justify-between mt-2"><span className="text-xs text-faint">Safe tx</span><Mono className="text-xs text-dim">{short(safeTxHash)}</Mono></div>
          </div>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Btn kind="ghost" onClick={() => { setSafeTxHash(null); setSelected(null) }}>Charge another</Btn>
          </div>
        </Card>
      </div>
    )
  }

  // Detail / charge form
  if (selected) {
    return (
      <div className="rise max-w-xl">
        <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-sm text-dim hover:text-ink transition mb-4">
          <IconArrowL size={16} /> All subscriptions
        </button>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <Payee logo={(selected.meta.recipient ?? selected.delegation.delegate).slice(2, 4).toUpperCase()} tint={tintFor(selected.meta.recipient ?? selected.delegation.delegate)} name={selected.meta.label} addr={short(selected.meta.recipient ?? selected.delegation.delegate)} />
            <StatusBadge status="active" size="sm" />
          </div>

          {isStream(selected) ? (
            <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 flex items-center justify-between">
              <span className="text-xs text-faint flex items-center gap-1.5"><IconRepeat size={13} /> Accrues</span>
              <span className="font-mono font-bold text-ink">{selected.meta.ratePerPeriod} <span className="text-dim text-sm font-semibold">USDC / {selected.meta.ratePeriod}</span></span>
            </div>
          ) : (
            <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 flex items-center justify-between">
              <span className="text-xs text-faint flex items-center gap-1.5"><IconLock size={13} /> Period cap</span>
              <span className="font-mono font-bold text-ink">{selected.meta.amount} <span className="text-dim text-sm font-semibold">{selected.meta.tokenAddress ? 'USDC' : ''} / {selected.meta.period}</span></span>
            </div>
          )}

          <ClaimProgress view={claim} symbol={selected.meta.tokenAddress ? 'USDC' : ''} />

          {error && (
            <div className="mt-4 rounded-xl px-3 py-2 text-sm text-danger" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}>{error}</div>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <label className="text-sm font-medium text-ink block mb-1.5">Pay to</label>
              <input type="text" placeholder="0x… recipient of the funds" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              {recipient && !isAddress(recipient) && <p className="text-xs text-danger mt-1">Invalid address</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-ink block mb-1.5">{isStream(selected) ? 'Claim amount' : 'Amount'}</label>
              <div className="relative">
                <input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setAmountEdited(true) }} min={0} step="any" className="pr-16" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{selected.meta.tokenAddress ? 'USDC' : ''}</span>
              </div>
              <p className="text-xs text-faint mt-1">
                Pre-filled with the claimable balance above. The exact amount is capped on-chain by the caveat; the Safe pays gas in ETH.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <Btn onClick={handleCharge} disabled={charging}>
              {charging ? 'Submitting…' : isStream(selected) ? 'Claim on-chain' : 'Charge on-chain'}
            </Btn>
          </div>
        </Card>
      </div>
    )
  }

  // List
  return (
    <div className="rise">
      <div className="flex items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Charge</h1>
          <p className="text-dim text-sm mt-1">Bill a subscription where this Safe is the payee — redeemed on-chain, settled in <span className="inline-flex align-middle"><USDC size={13} /></span>.</p>
        </div>
      </div>

      {subs.length === 0 ? (
        <Card className="p-10 text-center mt-5">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-raised ring-1 ring-line mx-auto text-faint"><IconBolt size={22} /></div>
          <h2 className="text-base font-semibold text-ink mt-4">No chargeable subscriptions</h2>
          <p className="text-sm text-dim mt-1 max-w-sm mx-auto">Subscriptions where this Safe ({short(safe.safeAddress)}) is the payee appear here, ready to charge every period.</p>
        </Card>
      ) : (
        <div className="space-y-3 mt-5">
          {subs.map((d) => {
            const payeeAddr = d.meta.recipient ?? d.delegation.delegate
            return (
              <Card key={d.meta.delegationHash} hover onClick={() => pick(d)} className="p-5 cursor-pointer flex items-center justify-between gap-4">
                <Payee logo={payeeAddr.slice(2, 4).toUpperCase()} tint={tintFor(payeeAddr)} name={d.meta.label} addr={short(payeeAddr)} />
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="font-mono font-bold text-ink tnum leading-none">{isStream(d) ? d.meta.ratePerPeriod : d.meta.amount} <span className="text-dim text-xs font-semibold">{d.meta.tokenAddress ? 'USDC' : ''}</span></div>
                    <div className="text-[11px] text-faint mt-1">/ {isStream(d) ? d.meta.ratePeriod : d.meta.period}</div>
                  </div>
                  {isStream(d) ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#22D3EE' }}><IconRepeat size={12} /> stream</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-faint"><IconCheck size={12} /> on-chain</span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
