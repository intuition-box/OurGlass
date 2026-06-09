import { useEffect, useMemo, useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, isAddress, parseUnits, erc20Abi, type Address, type Hex, type PublicClient } from 'viem'
import { baseSepolia, base, sepolia } from 'viem/chains'
import { getDelegations, type StoredDelegation } from '../lib/storage'
import {
  relayerUrlForChain,
  getCapabilities,
  chargeBundleViaRelayer,
  pollRelayerUntilDone,
  toRelayerJson,
  type ChainCapabilities,
} from '../lib/relayer1shot'
import { Card, Btn, GaslessButton, StatusBadge, Payee, Mono, USDC } from '../ui/components'
import { IconBolt, IconCheck, IconExt, IconAlert, IconLock, IconArrowL } from '../ui/icons'

const chains: Record<number, typeof baseSepolia | typeof base | typeof sepolia> = { 84532: baseSepolia, 11155111: sepolia, 8453: base }
const explorerTx = (id: number, h: string) =>
  id === 84532 ? `https://sepolia.basescan.org/tx/${h}` : id === 11155111 ? `https://sepolia.etherscan.io/tx/${h}` : `https://basescan.org/tx/${h}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const tintFor = (addr: string) => {
  const palette = ['#3B82F6', '#22D3EE', '#8B5CF6', '#34D399', '#FB7185', '#FBBF24']
  let h = 0
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export default function Charge() {
  const { safe } = useSafeAppsSDK()
  const [caps, setCaps] = useState<ChainCapabilities | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [selected, setSelected] = useState<StoredDelegation | null>(null)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [charging, setCharging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const subs = useMemo(
    () =>
      getDelegations().filter(
        (d) =>
          d.meta.safeAddress.toLowerCase() === safe.safeAddress.toLowerCase() &&
          d.meta.scopeType === 'erc20SpendingLimit' &&
          d.meta.status === 'signed',
      ),
    [safe.safeAddress],
  )

  useEffect(() => {
    let cancelled = false
    getCapabilities(relayerUrlForChain(safe.chainId), safe.chainId)
      .then((c) => !cancelled && setCaps(c))
      .catch((e: unknown) => !cancelled && setCapsError(e instanceof Error ? e.message : 'Relayer unavailable'))
    return () => {
      cancelled = true
    }
  }, [safe.chainId])

  const eligible = (d: StoredDelegation) => !!caps && d.delegation.delegate.toLowerCase() === caps.targetAddress.toLowerCase()

  function pick(d: StoredDelegation) {
    setSelected(d)
    setAmount(d.meta.amount ?? '')
    setRecipient('')
    setError(null)
    setTxHash(null)
  }

  async function handleCharge() {
    if (!selected || !caps) return
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
      // Base/baseSepolia carry an OP-stack tx formatter whose client type isn't
      // structurally the generic PublicClient the relayer helper expects.
      const client = createPublicClient({ chain, transport: http() }) as unknown as PublicClient

      const tokenAddress = selected.meta.tokenAddress
      if (!tokenAddress) throw new Error('Subscription has no token address')
      let decimals = 6
      try {
        decimals = await client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' })
      } catch {
        // default to USDC decimals
      }

      const delegation = {
        ...selected.delegation,
        caveats: selected.delegation.caveats.map((c) => ({ ...c, args: '0x' as Hex })),
      }
      const taskId = await chargeBundleViaRelayer({
        relayerUrl: relayerUrlForChain(safe.chainId),
        chainId: safe.chainId,
        capabilities: caps,
        permissionContext: [toRelayerJson(delegation)],
        token: { address: tokenAddress, decimals },
        workAmount: parseUnits(amount, decimals),
        recipient: recipient as Address,
        client,
      })
      const status = await pollRelayerUntilDone(relayerUrlForChain(safe.chainId), taskId, { timeoutMs: 90_000 }).catch(
        (e: unknown) => {
          if (e instanceof Error && /Timeout/.test(e.message)) return null
          throw e
        },
      )
      if (status && (status.status === 400 || status.status === 500)) {
        throw new Error(`Relayer rejected the charge: ${status.message ?? ''}`)
      }
      setTxHash(status?.receipt?.transactionHash ?? status?.hash ?? taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  // Success
  if (txHash && selected) {
    return (
      <div className="rise max-w-xl">
        <Card className="p-6 text-center">
          <div className="grid place-items-center w-12 h-12 rounded-2xl mx-auto" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}>
            <IconBolt size={24} />
          </div>
          <h2 className="text-lg font-bold text-ink mt-4">Charged gasless</h2>
          <p className="text-sm text-dim mt-1">{amount} {selected.meta.tokenAddress ? 'USDC' : ''} settled via the 1Shot relayer — no ETH spent.</p>
          <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 text-left">
            <div className="flex items-center justify-between"><span className="text-xs text-faint">Recipient</span><Mono className="text-xs text-dim">{short(recipient)}</Mono></div>
            <div className="flex items-center justify-between mt-2"><span className="text-xs text-faint">Reference</span><Mono className="text-xs text-dim">{short(txHash)}</Mono></div>
          </div>
          <div className="mt-5 flex items-center justify-center gap-2">
            {txHash.startsWith('0x') && txHash.length === 66 && (
              <a href={explorerTx(safe.chainId, txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-raised ring-1 ring-line2 px-3 h-9 text-sm text-ink hover:bg-[#212B43] transition">
                View on explorer <IconExt size={13} className="opacity-60" />
              </a>
            )}
            <Btn kind="ghost" onClick={() => { setTxHash(null); setSelected(null) }}>Charge another</Btn>
          </div>
        </Card>
      </div>
    )
  }

  // Detail / charge form
  if (selected) {
    const ok = eligible(selected)
    return (
      <div className="rise max-w-xl">
        <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-sm text-dim hover:text-ink transition mb-4">
          <IconArrowL size={16} /> All subscriptions
        </button>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <Payee logo={selected.delegation.delegate.slice(2, 4).toUpperCase()} tint={tintFor(selected.delegation.delegate)} name={selected.meta.label} addr={short(selected.delegation.delegate)} />
            <StatusBadge status="active" size="sm" />
          </div>

          <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 flex items-center justify-between">
            <span className="text-xs text-faint flex items-center gap-1.5"><IconLock size={13} /> Period cap</span>
            <span className="font-mono font-bold text-ink">{selected.meta.amount} <span className="text-dim text-sm font-semibold">{selected.meta.tokenAddress ? 'USDC' : ''} / {selected.meta.period}</span></span>
          </div>

          {!ok && (
            <div className="mt-4 rounded-xl px-3 py-3 text-xs leading-relaxed" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)', color: '#FBBF24' }}>
              <div className="flex items-center gap-1.5 font-semibold mb-1"><IconAlert size={13} /> Not gasless-eligible</div>
              For a gasless charge the subscription's payee (delegate) must be the 1Shot relayer address{caps ? ` (${short(caps.targetAddress)})` : ''}. This one delegates to {short(selected.delegation.delegate)}.
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
              <label className="text-sm font-medium text-ink block mb-1.5">Amount</label>
              <div className="relative">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={0} step="any" className="pr-16" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{selected.meta.tokenAddress ? 'USDC' : ''}</span>
              </div>
              <p className="text-xs text-faint mt-1">Defaults to the period cap. The relayer's fee is taken in the token; capped on-chain.</p>
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <GaslessButton onClick={handleCharge} disabled={!ok || charging} intensity={ok ? 1.5 : 0.5}>
              {charging ? 'Charging…' : 'Charge gasless'}
            </GaslessButton>
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
          <p className="text-dim text-sm mt-1">Bill a signed subscription for this period — gasless, settled in <span className="inline-flex align-middle"><USDC size={13} /></span>.</p>
        </div>
      </div>

      {capsError && (
        <div className="mt-4 rounded-xl px-3 py-2 text-sm text-pending" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)' }}>
          Relayer: {capsError}
        </div>
      )}

      {subs.length === 0 ? (
        <Card className="p-10 text-center mt-5">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-raised ring-1 ring-line mx-auto text-faint"><IconBolt size={22} /></div>
          <h2 className="text-base font-semibold text-ink mt-4">No chargeable subscriptions</h2>
          <p className="text-sm text-dim mt-1 max-w-sm mx-auto">Active ERC-20 subscriptions for this Safe appear here, ready to charge every period.</p>
        </Card>
      ) : (
        <div className="space-y-3 mt-5">
          {subs.map((d) => {
            const ok = eligible(d)
            return (
              <Card key={d.meta.delegationHash} hover onClick={() => pick(d)} className="p-5 cursor-pointer flex items-center justify-between gap-4">
                <Payee logo={d.delegation.delegate.slice(2, 4).toUpperCase()} tint={tintFor(d.delegation.delegate)} name={d.meta.label} addr={short(d.delegation.delegate)} />
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="font-mono font-bold text-ink tnum leading-none">{d.meta.amount} <span className="text-dim text-xs font-semibold">{d.meta.tokenAddress ? 'USDC' : ''}</span></div>
                    <div className="text-[11px] text-faint mt-1">/ {d.meta.period}</div>
                  </div>
                  {caps && (
                    ok ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--accent)' }}><IconBolt size={12} /> gasless</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-faint"><IconCheck size={12} /> manual</span>
                    )
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
