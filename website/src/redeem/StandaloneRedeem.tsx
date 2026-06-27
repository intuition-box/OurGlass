import { useMemo, useRef, useState } from 'react'
import { createPublicClient, http, isAddress, erc20Abi, formatUnits, type Address, type PublicClient, type WalletClient } from 'viem'
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi'
import { importDelegationsJson, type StoredDelegation } from './lib/storage'
import { ipfsToHttp } from './lib/subscriptionTerms'
import { redeemSubscriptionDirect } from './lib/redeemDirect'
import { streamedAvailable } from './lib/streamTerms'
import { MAX_UINT256 } from './lib/streamRate'
import { useClaimState } from './hooks/useClaimState'
import { ClaimProgress } from './ui/ClaimProgress'
import { AnimatedAmount } from './ui/AnimatedAmount'
import { SELECTABLE_CHAINS, findChain, chainName, explorerTx, rpcUrl } from './config/supported-chains'
import { Logo, Card, Btn, StatusBadge, Payee, Mono } from './ui/components'
import { IconCheck, IconExt, IconAlert, IconLock, IconRepeat, IconDoc, IconCube, IconArrowL } from './ui/icons'

const isStream = (d: StoredDelegation) => d.meta.scopeType === 'erc20Streaming'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const tintFor = (addr: string) => {
  const palette = ['#3B82F6', '#22D3EE', '#8B5CF6', '#34D399', '#FB7185', '#FBBF24']
  let h = 0
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export function StandaloneRedeem() {
  const [chainId, setChainId] = useState(84532)
  const [jsonInput, setJsonInput] = useState('')
  const [sub, setSub] = useState<StoredDelegation | null>(null)
  const [recipient, setRecipient] = useState('')
  const [charging, setCharging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [chargedAmount, setChargedAmount] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // The live claim amount (raw wei), updated each animation frame so the redeem
  // bills exactly what the ticking counter shows.
  const liveAmountRef = useRef(0n)

  // Claimed / claimable / cap for the loaded delegation, read from the caveat
  // enforcer (stream lifetime cap, or subscription per-period cap).
  const claim = useClaimState(sub)

  const { address, isConnected, chainId: walletChainId } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: walletClient } = useWalletClient()
  const injectedConnector = connectors.find((c) => c.id === 'injected') ?? connectors.find((c) => c.type === 'injected')

  // chainId always comes from the selector (a SELECTABLE_CHAINS id), so it resolves.
  const chain = useMemo(() => findChain(chainId)!, [chainId])

  function parse(text: string) {
    setError(null)
    setTxHash(null)
    try {
      const parsed = importDelegationsJson(text)[0]
      if (!parsed) throw new Error('No subscription found in JSON')
      setSub(parsed)
      setRecipient(parsed.meta.recipient ?? '')
      if (parsed.meta.chainId && SELECTABLE_CHAINS.some((c) => c.id === parsed.meta.chainId)) setChainId(parsed.meta.chainId)
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

  // Only the delegate (the payee the subscriber signed for) can redeem this delegation.
  const isDelegate = isConnected && !!sub && address?.toLowerCase() === sub.delegation.delegate.toLowerCase()
  const wrongChain = isConnected && walletChainId !== chainId
  const canRedeem = isDelegate && !wrongChain && !!walletClient && !charging

  async function handleRedeem() {
    if (!sub) return
    if (!walletClient) return setError('Connect your wallet first.')
    if (address?.toLowerCase() !== sub.delegation.delegate.toLowerCase())
      return setError('Connected wallet must be the payee (delegate) of this subscription.')
    if (walletChainId !== chainId) return setError(`Switch your wallet to ${chainName(chainId)}.`)
    if (!isAddress(recipient)) return setError('Enter a valid recipient address.')
    if (liveAmountRef.current <= 0n) return setError('Nothing to claim yet.')
    setCharging(true)
    setError(null)
    try {
      // Base/baseSepolia carry an OP-stack tx formatter whose client type isn't the
      // generic PublicClient the SDK helper expects.
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) }) as unknown as PublicClient

      // The live counter extrapolates with Date.now(), which runs ahead of the chain's
      // block.timestamp — claiming it overshoots the enforcer's allowance and reverts
      // with allowance-exceeded. Clamp to what the enforcer unlocks at the latest block
      // (always <= the mining block's timestamp, so the redeem stays within allowance).
      let amountRaw = liveAmountRef.current
      if (isStream(sub)) {
        const block = await publicClient.getBlock()
        const unlocked = streamedAvailable({
          amountPerSecondRaw: sub.meta.amountPerSecond ?? '0',
          initialAmountRaw: sub.meta.initialAmount ?? '0',
          maxAmountRaw: sub.meta.maxAmount ?? MAX_UINT256.toString(),
          startTime: sub.meta.startTime ?? 0,
          nowSeconds: Number(block.timestamp),
        })
        const safe = unlocked > claim.claimed ? unlocked - claim.claimed : 0n
        if (amountRaw > safe) amountRaw = safe
      }
      if (amountRaw <= 0n) throw new Error('Nothing to claim yet — try again in a moment.')
      const amountStr = formatUnits(amountRaw, claim.decimals)

      const tokenAddress = sub.meta.tokenAddress
      if (!tokenAddress) throw new Error('Subscription has no token address')
      let decimals = 6
      try {
        decimals = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' })
      } catch {
        // default USDC decimals
      }
      const hash = await redeemSubscriptionDirect({
        // wagmi's wallet client is a viem WalletClient at runtime.
        walletClient: walletClient as unknown as WalletClient,
        publicClient,
        chainId,
        delegation: sub.delegation,
        token: { address: tokenAddress, decimals },
        amount: amountStr,
        recipient: recipient as Address,
      })
      setChargedAmount(amountStr)
      setTxHash(hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redeem failed')
    } finally {
      setCharging(false)
    }
  }

  const httpUri = sub?.meta.agreement && !sub.meta.agreement.uri.startsWith('ipfs://local-') ? ipfsToHttp(sub.meta.agreement.uri) : undefined

  return (
    <div className="og-redeem min-h-screen">
      <header className="sticky top-0 z-10 glass-strong">
        <div className="max-w-3xl mx-auto h-14 px-5 flex items-center justify-between border-b border-line">
          <Logo size={30} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-faint">Biller console</span>
            <select aria-label="Network" value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="h-9 text-sm" style={{ width: 'auto' }}>
              {SELECTABLE_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {isConnected && address ? (
              <button
                onClick={() => disconnect()}
                title="Disconnect"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl glass-soft ring-1 ring-line2 text-xs font-mono text-dim hover:text-ink transition"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34D399' }} />
                {short(address)}
              </button>
            ) : (
              <Btn kind="secondary" onClick={() => injectedConnector && connect({ connector: injectedConnector })} disabled={!injectedConnector}>
                Connect wallet
              </Btn>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 rise">
        {txHash && sub ? (
          <div className="max-w-xl mx-auto">
            <Card className="p-6 text-center">
              <div className="grid place-items-center w-12 h-12 rounded-2xl mx-auto" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}>
                <IconCheck size={24} />
              </div>
              <h2 className="text-lg font-bold text-ink mt-4">Charged</h2>
              <p className="text-sm text-dim mt-1">{chargedAmount} USDC redeemed on-chain — capped by the signed caveat.</p>
              <div className="mt-5 rounded-xl glass-soft ring-1 ring-line p-4 text-left">
                <div className="flex items-center justify-between"><span className="text-xs text-faint">Recipient</span><Mono className="text-xs text-dim">{short(recipient)}</Mono></div>
                <div className="flex items-center justify-between mt-2"><span className="text-xs text-faint">Transaction</span><Mono className="text-xs text-dim">{short(txHash)}</Mono></div>
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                {txHash.startsWith('0x') && txHash.length === 66 && (
                  <a href={explorerTx(chainId, txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl glass-soft ring-1 ring-line2 px-3 h-9 text-sm text-ink hover:bg-[#212B43] transition">
                    View on explorer <IconExt size={13} className="opacity-60" />
                  </a>
                )}
                <Btn kind="ghost" onClick={() => { setTxHash(null); setSub(null); setJsonInput(''); setRecipient(''); setChargedAmount(''); liveAmountRef.current = 0n }}>Charge another</Btn>
              </div>
            </Card>
          </div>
        ) : !sub ? (
          <div className="max-w-xl mx-auto">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">Charge a subscription</h1>
            <p className="text-dim text-sm mt-1">Load a signed subscription and bill this period. The payee redeems on-chain — gas in ETH, capped by the caveat.</p>

            <Card className="p-6 mt-5 space-y-5">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                onClick={() => fileRef.current?.click()}
                className="rounded-2xl p-8 text-center cursor-pointer transition-colors"
                style={{ boxShadow: 'inset 0 0 0 1.5px var(--color-line)' }}
              >
                <div className="grid place-items-center w-11 h-11 rounded-2xl glass-soft ring-1 ring-line mx-auto text-faint"><IconDoc size={20} /></div>
                <p className="text-sm text-dim mt-3">Drop the subscription JSON or <span style={{ color: 'var(--accent)' }}>click to browse</span></p>
                <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </div>
              <div>
                <label htmlFor="redeem-json" className="text-sm font-medium text-ink block mb-1.5">Or paste JSON</label>
                <textarea id="redeem-json" value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} rows={6} placeholder='{"delegation": {…}, "meta": {…}}' className="font-mono text-xs" />
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
                <Payee logo={(sub.meta.recipient ?? sub.delegation.delegate).slice(2, 4).toUpperCase()} tint={tintFor(sub.meta.recipient ?? sub.delegation.delegate)} name={sub.meta.label} addr={short(sub.meta.recipient ?? sub.delegation.delegate)} />
                <StatusBadge status={sub.meta.status === 'revoked' ? 'revoked' : 'active'} size="sm" />
              </div>

              {isStream(sub) ? (
                <div className="mt-5 rounded-xl glass-soft ring-1 ring-line p-4 flex items-center justify-between">
                  <span className="text-xs text-faint flex items-center gap-1.5"><IconRepeat size={13} /> Accrues</span>
                  <span className="font-mono font-bold text-ink">{sub.meta.ratePerPeriod} <span className="text-dim text-sm font-semibold">USDC / {sub.meta.ratePeriod}</span></span>
                </div>
              ) : (
                <div className="mt-5 rounded-xl glass-soft ring-1 ring-line p-4 flex items-center justify-between">
                  <span className="text-xs text-faint flex items-center gap-1.5"><IconLock size={13} /> Period cap</span>
                  <span className="font-mono font-bold text-ink">{sub.meta.amount} <span className="text-dim text-sm font-semibold">USDC / {sub.meta.period}</span></span>
                </div>
              )}

              <ClaimProgress view={claim} symbol="USDC" />

              {httpUri && (
                <a href={httpUri} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-[color:var(--accent)] hover:underline"><IconCube size={12} /> {sub.meta.agreement!.cid.slice(0, 18)}… <IconExt size={10} className="opacity-60" /></a>
              )}

              {!isConnected && (
                <div className="mt-4 rounded-xl px-3 py-3 text-xs leading-relaxed" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)', color: '#FBBF24' }}>
                  <div className="flex items-center gap-1.5 font-semibold mb-1"><IconAlert size={13} /> Wallet not connected</div>
                  Connect the payee wallet ({short(sub.delegation.delegate)}) to redeem this period on-chain.
                </div>
              )}
              {isConnected && !isDelegate && (
                <div className="mt-4 rounded-xl px-3 py-3 text-xs leading-relaxed" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)', color: '#FBBF24' }}>
                  <div className="flex items-center gap-1.5 font-semibold mb-1"><IconAlert size={13} /> Wrong wallet</div>
                  Only the payee (delegate) can redeem. This subscription's payee is {short(sub.delegation.delegate)}; you are connected as {short(address!)}.
                </div>
              )}
              {isDelegate && wrongChain && (
                <div className="mt-4 rounded-xl px-3 py-3 text-xs leading-relaxed" style={{ background: 'rgba(251,191,36,.08)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,.25)', color: '#FBBF24' }}>
                  <div className="flex items-center gap-1.5 font-semibold mb-1"><IconAlert size={13} /> Wrong network</div>
                  Switch your wallet to {chainName(chainId)} to redeem.
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-xl px-3 py-2 text-sm text-danger flex items-center gap-2" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}><IconAlert size={15} /> {error}</div>
              )}

              <div className="mt-5 space-y-4">
                <div>
                  <label htmlFor="redeem-recipient" className="text-sm font-medium text-ink block mb-1.5">Pay to</label>
                  <input id="redeem-recipient" type="text" placeholder="0x… recipient of the funds" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                  {recipient && !isAddress(recipient) && <p className="text-xs text-danger mt-1">Invalid address</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-ink block mb-1.5">Claim amount</label>
                  <div className="flex items-baseline gap-2">
                    {claim.loading ? (
                      <span className="font-mono font-bold text-faint tnum" style={{ fontSize: 30 }}>—</span>
                    ) : (
                      <span style={{ fontSize: 30 }} className="leading-none">
                        <AnimatedAmount
                          base={claim.claimable}
                          ratePerSecondRaw={isStream(sub) ? BigInt(sub.meta.amountPerSecond ?? '0') : 0n}
                          decimals={claim.decimals}
                          max={claim.cap !== null ? (claim.cap > claim.claimed ? claim.cap - claim.claimed : 0n) : null}
                          onValue={(raw) => { liveAmountRef.current = raw }}
                        />
                      </span>
                    )}
                    <span className="text-sm text-faint">USDC</span>
                  </div>
                  <p className="text-xs text-faint mt-1">
                    {isStream(sub) ? 'Accrues live by the second. Claims the full amount shown — capped on-chain by the caveat; you pay gas in ETH.' : 'The claimable amount this period. Capped on-chain by the caveat; you pay gas in ETH.'}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-center">
                <Btn onClick={handleRedeem} disabled={!canRedeem}>
                  {charging ? 'Redeeming…' : isStream(sub) ? 'Claim on-chain' : 'Charge on-chain'}
                </Btn>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
