import { useEffect, useMemo, useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, isAddress, erc20Abi, formatUnits, BaseError, type Address } from 'viem'
import { baseSepolia, base, sepolia } from 'viem/chains'
import { getDelegations, type StoredDelegation } from '../lib/storage'
import { streamedAvailable } from '../lib/streamTerms'
import { buildRedeemTx } from '../lib/redeemDirect'
import { Card, Btn, StatusBadge, Payee, Mono, USDC } from '../ui/components'
import { IconBolt, IconCheck, IconLock, IconArrowL, IconRepeat } from '../ui/icons'

const isStream = (d: StoredDelegation) => d.meta.scopeType === 'erc20Streaming'

const chains: Record<number, typeof baseSepolia | typeof base | typeof sepolia> = { 84532: baseSepolia, 11155111: sepolia, 8453: base }
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const tintFor = (addr: string) => {
  const palette = ['#3B82F6', '#22D3EE', '#8B5CF6', '#34D399', '#FB7185', '#FBBF24']
  let h = 0
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export default function Charge() {
  const { sdk, safe } = useSafeAppsSDK()
  const [selected, setSelected] = useState<StoredDelegation | null>(null)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [charging, setCharging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [safeTxHash, setSafeTxHash] = useState<string | null>(null)

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
    // Subscriptions default to the period cap; streams default to the estimated
    // accrued balance (filled by the effect below once decimals are known).
    setAmount(isStream(d) ? '' : d.meta.amount ?? '')
    setRecipient(d.meta.recipient ?? '')
    setError(null)
    setSafeTxHash(null)
  }

  // Estimate the claimable streamed balance for the selected stream. The estimate
  // is UX only — the erc20Streaming caveat caps the actual claim on-chain.
  useEffect(() => {
    if (!selected || !isStream(selected)) return
    const m = selected.meta
    if (!m.tokenAddress || !m.amountPerSecond || !m.maxAmount || m.startTime == null) return
    let cancelled = false
    ;(async () => {
      const chain = chains[safe.chainId]
      if (!chain) return
      const client = createPublicClient({ chain, transport: http() })
      let decimals = 6
      try {
        decimals = await client.readContract({ address: m.tokenAddress as Address, abi: erc20Abi, functionName: 'decimals' })
      } catch {
        // default to USDC decimals
      }
      const available = streamedAvailable({
        amountPerSecondRaw: m.amountPerSecond!,
        initialAmountRaw: m.initialAmount ?? '0',
        maxAmountRaw: m.maxAmount!,
        startTime: m.startTime!,
        nowSeconds: Math.floor(Date.now() / 1000),
      })
      if (!cancelled) setAmount(formatUnits(available, decimals))
    })()
    return () => {
      cancelled = true
    }
  }, [selected, safe.chainId])

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
      const chain = chains[safe.chainId]
      if (!chain) throw new Error(`Unsupported chain: ${safe.chainId}`)
      const client = createPublicClient({ chain, transport: http() })
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
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={0} step="any" className="pr-16" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{selected.meta.tokenAddress ? 'USDC' : ''}</span>
              </div>
              <p className="text-xs text-faint mt-1">
                {isStream(selected)
                  ? 'Estimated accrued balance. The exact claimable amount is enforced on-chain by the stream caveat; the Safe pays gas in ETH.'
                  : 'Defaults to the period cap. Capped on-chain by the caveat; the Safe pays gas in ETH.'}
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
