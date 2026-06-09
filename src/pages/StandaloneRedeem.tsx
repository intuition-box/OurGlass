import { useEffect, useMemo, useRef, useState } from 'react'
import { createPublicClient, http, isAddress, parseUnits, erc20Abi, type Address, type Hex, type PublicClient } from 'viem'
import { baseSepolia, base } from 'viem/chains'
import { importDelegationsJson, type StoredDelegation } from '../lib/storage'
import { ipfsToHttp } from '../lib/subscriptionTerms'
import {
  relayerUrlForChain,
  getCapabilities,
  chargeBundleViaRelayer,
  pollRelayerUntilDone,
  toRelayerJson,
  type ChainCapabilities,
} from '../lib/relayer1shot'
import { Logo, Card, Btn, GaslessButton, StatusBadge, Payee, Mono } from '../ui/components'
import { IconBolt, IconExt, IconAlert, IconLock, IconDoc, IconCube, IconArrowL } from '../ui/icons'

const CHAINS: { id: number; label: string; chain: typeof baseSepolia | typeof base }[] = [
  { id: 84532, label: 'Base Sepolia', chain: baseSepolia },
  { id: 8453, label: 'Base', chain: base },
]
const explorerTx = (id: number, h: string) => (id === 84532 ? `https://sepolia.basescan.org/tx/${h}` : `https://basescan.org/tx/${h}`)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const tintFor = (addr: string) => {
  const palette = ['#3B82F6', '#22D3EE', '#8B5CF6', '#34D399', '#FB7185', '#FBBF24']
  let h = 0
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export default function StandaloneRedeem() {
  const [chainId, setChainId] = useState(84532)
  const [caps, setCaps] = useState<ChainCapabilities | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [sub, setSub] = useState<StoredDelegation | null>(null)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [charging, setCharging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const chain = useMemo(() => CHAINS.find((c) => c.id === chainId)!.chain, [chainId])

  useEffect(() => {
    let cancelled = false
    setCaps(null)
    setCapsError(null)
    getCapabilities(relayerUrlForChain(chainId), chainId)
      .then((c) => !cancelled && setCaps(c))
      .catch((e: unknown) => !cancelled && setCapsError(e instanceof Error ? e.message : 'Relayer unavailable'))
    return () => {
      cancelled = true
    }
  }, [chainId])

  function parse(text: string) {
    setError(null)
    setTxHash(null)
    try {
      const parsed = importDelegationsJson(text)[0]
      if (!parsed) throw new Error('No subscription found in JSON')
      setSub(parsed)
      setAmount(parsed.meta.amount ?? '')
      if (parsed.meta.chainId && CHAINS.some((c) => c.id === parsed.meta.chainId)) setChainId(parsed.meta.chainId)
    } catch (err) {
      setSub(null)
      setError(err instanceof Error ? err.message : 'Invalid delegation JSON')
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setJsonInput(text)
      parse(text)
    }
    reader.readAsText(file)
  }

  const eligible = !!caps && !!sub && sub.delegation.delegate.toLowerCase() === caps.targetAddress.toLowerCase()

  async function handleCharge() {
    if (!sub || !caps) return
    if (!isAddress(recipient)) return setError('Enter a valid recipient address.')
    if (!amount || parseFloat(amount) <= 0) return setError('Enter an amount to charge.')
    setCharging(true)
    setError(null)
    try {
      // Base/baseSepolia carry an OP-stack tx formatter whose client type isn't
      // the generic PublicClient the relayer helper expects.
      const client = createPublicClient({ chain, transport: http() }) as unknown as PublicClient
      const tokenAddress = sub.meta.tokenAddress
      if (!tokenAddress) throw new Error('Subscription has no token address')
      let decimals = 6
      try {
        decimals = await client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' })
      } catch {
        // default USDC decimals
      }
      const delegation = {
        ...sub.delegation,
        caveats: sub.delegation.caveats.map((c) => ({ ...c, args: '0x' as Hex })),
      }
      const taskId = await chargeBundleViaRelayer({
        relayerUrl: relayerUrlForChain(chainId),
        chainId,
        capabilities: caps,
        permissionContext: [toRelayerJson(delegation)],
        token: { address: tokenAddress, decimals },
        workAmount: parseUnits(amount, decimals),
        recipient: recipient as Address,
        client,
      })
      const status = await pollRelayerUntilDone(relayerUrlForChain(chainId), taskId, { timeoutMs: 90_000 }).catch(
        (e: unknown) => {
          if (e instanceof Error && /Timeout/.test(e.message)) return null
          throw e
        },
      )
      if (status && (status.status === 400 || status.status === 500)) throw new Error(`Relayer rejected the charge: ${status.message ?? ''}`)
      setTxHash(status?.receipt?.transactionHash ?? status?.hash ?? taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  const httpUri = sub?.meta.agreement && !sub.meta.agreement.uri.startsWith('ipfs://local-') ? ipfsToHttp(sub.meta.agreement.uri) : undefined

  return (
    <div className="min-h-screen bg-base">
      <header className="sticky top-0 z-10" style={{ background: 'rgba(8,11,18,.6)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-3xl mx-auto h-14 px-5 flex items-center justify-between border-b border-line">
          <Logo size={26} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-faint">Biller console</span>
            <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="h-9 text-sm" style={{ width: 'auto' }}>
              {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 rise">
        {txHash && sub ? (
          <div className="max-w-xl mx-auto">
            <Card className="p-6 text-center">
              <div className="grid place-items-center w-12 h-12 rounded-2xl mx-auto" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}>
                <IconBolt size={24} />
              </div>
              <h2 className="text-lg font-bold text-ink mt-4">Charged gasless</h2>
              <p className="text-sm text-dim mt-1">{amount} USDC settled via the 1Shot relayer — no ETH spent.</p>
              <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 text-left">
                <div className="flex items-center justify-between"><span className="text-xs text-faint">Recipient</span><Mono className="text-xs text-dim">{short(recipient)}</Mono></div>
                <div className="flex items-center justify-between mt-2"><span className="text-xs text-faint">Reference</span><Mono className="text-xs text-dim">{short(txHash)}</Mono></div>
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                {txHash.startsWith('0x') && txHash.length === 66 && (
                  <a href={explorerTx(chainId, txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-raised ring-1 ring-line2 px-3 h-9 text-sm text-ink hover:bg-[#212B43] transition">
                    View on explorer <IconExt size={13} className="opacity-60" />
                  </a>
                )}
                <Btn kind="ghost" onClick={() => { setTxHash(null); setSub(null); setJsonInput(''); setRecipient('') }}>Charge another</Btn>
              </div>
            </Card>
          </div>
        ) : !sub ? (
          <div className="max-w-xl mx-auto">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">Charge a subscription</h1>
            <p className="text-dim text-sm mt-1">Load a signed subscription and bill this period — gasless, settled in USDC by the relayer.</p>

            {capsError && (
              <div className="mt-4 rounded-xl px-3 py-2 text-sm text-pending" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)' }}>Relayer: {capsError}</div>
            )}

            <Card className="p-6 mt-5 space-y-5">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                onClick={() => fileRef.current?.click()}
                className="rounded-2xl p-8 text-center cursor-pointer transition-colors"
                style={{ boxShadow: 'inset 0 0 0 1.5px var(--color-line)' }}
              >
                <div className="grid place-items-center w-11 h-11 rounded-2xl bg-raised ring-1 ring-line mx-auto text-faint"><IconDoc size={20} /></div>
                <p className="text-sm text-dim mt-3">Drop the subscription JSON or <span style={{ color: 'var(--accent)' }}>click to browse</span></p>
                <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </div>
              <div>
                <label className="text-sm font-medium text-ink block mb-1.5">Or paste JSON</label>
                <textarea value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} rows={6} placeholder='{"delegation": {…}, "meta": {…}}' className="font-mono text-xs" />
                <div className="mt-2"><Btn kind="secondary" onClick={() => parse(jsonInput)} disabled={!jsonInput.trim()}>Load subscription</Btn></div>
              </div>
              {error && (
                <div className="rounded-xl px-3 py-2 text-sm text-danger flex items-center gap-2" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}><IconAlert size={15} /> {error}</div>
              )}
            </Card>
          </div>
        ) : (
          <div className="max-w-xl mx-auto">
            <button onClick={() => { setSub(null); setError(null) }} className="inline-flex items-center gap-1.5 text-sm text-dim hover:text-ink transition mb-4">
              <IconArrowL size={16} /> Load another
            </button>
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4">
                <Payee logo={sub.delegation.delegate.slice(2, 4).toUpperCase()} tint={tintFor(sub.delegation.delegate)} name={sub.meta.label} addr={short(sub.delegation.delegate)} />
                <StatusBadge status={sub.meta.status === 'revoked' ? 'revoked' : 'active'} size="sm" />
              </div>

              <div className="mt-5 rounded-xl bg-raised ring-1 ring-line p-4 flex items-center justify-between">
                <span className="text-xs text-faint flex items-center gap-1.5"><IconLock size={13} /> Period cap</span>
                <span className="font-mono font-bold text-ink">{sub.meta.amount} <span className="text-dim text-sm font-semibold">USDC / {sub.meta.period}</span></span>
              </div>

              {httpUri && (
                <a href={httpUri} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-[color:var(--accent)] hover:underline"><IconCube size={12} /> {sub.meta.agreement!.cid.slice(0, 18)}… <IconExt size={10} className="opacity-60" /></a>
              )}

              {!eligible && (
                <div className="mt-4 rounded-xl px-3 py-3 text-xs leading-relaxed" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)', color: '#FBBF24' }}>
                  <div className="flex items-center gap-1.5 font-semibold mb-1"><IconAlert size={13} /> Not gasless-eligible on {CHAINS.find((c) => c.id === chainId)!.label}</div>
                  The subscription's payee (delegate) must be the 1Shot relayer address{caps ? ` (${short(caps.targetAddress)})` : ''}. This one delegates to {short(sub.delegation.delegate)}.
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-xl px-3 py-2 text-sm text-danger flex items-center gap-2" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}><IconAlert size={15} /> {error}</div>
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
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">USDC</span>
                  </div>
                  <p className="text-xs text-faint mt-1">Defaults to the period cap. The relayer's fee is taken in the token; capped on-chain.</p>
                </div>
              </div>

              <div className="mt-6 flex justify-center">
                <GaslessButton onClick={handleCharge} disabled={!eligible || charging} intensity={eligible ? 1.5 : 0.5}>
                  {charging ? 'Charging…' : 'Charge gasless'}
                </GaslessButton>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
