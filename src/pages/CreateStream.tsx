import { useMemo, useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, isAddress, parseUnits, formatUnits, type Address, type Hex } from 'viem'
import { createDelegation } from '@metamask/smart-accounts-kit'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { findChain, USDC_ADDRESS } from '../config/supported-chains'
import { DEFAULT_SALT } from '../lib/module'
import { buildDelegationTypedData, computeDelegationHash, type DelegationStruct } from '../lib/delegations'
import { ipfsToHttp, type PinResult } from '../lib/subscriptionTerms'
import {
  buildStreamTerms,
  buildStreamAgreement,
  pinStreamAgreement,
  offlinePinStream,
  streamedAvailable,
} from '../lib/streamTerms'
import { MAX_UINT256, perSecondForTotal, humanDuration } from '../lib/streamRate'
import { getEnvironment } from '../lib/environment'
import { saveDelegation, type StoredDelegation } from '../lib/storage'
import { Card, Btn, GaslessButton, USDC, Mono, CopyChip, Payee } from '../ui/components'
import { IconCube, IconLock, IconCheck, IconExt, IconHash, IconRepeat, IconCal } from '../ui/icons'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const trimAmount = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)
const trimNum = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '')
const MONTH = 2_592_000

// Three display scales for the rate table. Same per-second flow, shown at each
// scale; the example 150 / 300 / 3600 is exactly half-month / month / 12×month.
const RATE_SCALES = [
  { key: 'fortnight', label: 'Bi-weekly', seconds: 1_296_000 },
  { key: 'month', label: 'Monthly', seconds: MONTH },
  { key: 'year', label: 'Yearly', seconds: 31_104_000 },
]

const DURATION_UNITS = [
  { key: 'year', label: 'years', seconds: 31_557_600 },
  { key: 'month', label: 'months', seconds: 2_592_000 },
  { key: 'week', label: 'weeks', seconds: 604_800 },
  { key: 'day', label: 'days', seconds: 86_400 },
]

const dateStr = (sec: number) => new Date(sec * 1000).toLocaleDateString()

type SignStep = 'idle' | 'building' | 'pinning' | 'signing'
type BoundMode = 'revocation' | 'hardcap'

export default function CreateStream() {
  const { sdk, safe } = useSafeAppsSDK()

  // Block 1 — Beneficiary
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [recipient, setRecipient] = useState('')

  // Block 2 — Payment details
  const [useCustomToken, setUseCustomToken] = useState(false)
  const [customToken, setCustomToken] = useState('')
  const [customDecimals, setCustomDecimals] = useState(6)
  const [amountPerSecond, setAmountPerSecond] = useState<bigint>(0n)
  const [activeScale, setActiveScale] = useState<string | null>(null)
  const [activeRateText, setActiveRateText] = useState('')
  const [upfront, setUpfront] = useState('0')

  // Block 3 — Security / limit
  const [boundMode, setBoundMode] = useState<BoundMode>('revocation')
  const [capDurationN, setCapDurationN] = useState('')
  const [capDurationUnit, setCapDurationUnit] = useState('month')
  const [activeTotal, setActiveTotal] = useState<string | null>(null)

  const [signing, setSigning] = useState(false)
  const [step, setStep] = useState<SignStep>('idle')
  const [pinnedCid, setPinnedCid] = useState<string | null>(null)
  const [signed, setSigned] = useState<StoredDelegation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const defaultUsdc = USDC_ADDRESS[safe.chainId]
  const tokenAddress = useCustomToken ? customToken : defaultUsdc
  const decimals = useCustomToken ? customDecimals : 6
  const tokenSymbol = useCustomToken ? 'tokens' : 'USDC'
  const recipientValid = isAddress(recipient)
  const tokenValid = !!tokenAddress && isAddress(tokenAddress)

  const fmt = (raw: bigint) => trimAmount(formatUnits(raw, decimals))
  const upfrontRaw = useMemo<bigint>(() => {
    try { return parseUnits(upfront || '0', decimals) } catch { return 0n }
  }, [upfront, decimals])

  // ---- Rate table (pivot = amountPerSecond) ----
  function rateCellValue(scaleKey: string, scaleSeconds: number) {
    if (activeScale === scaleKey) return activeRateText
    return amountPerSecond > 0n ? trimAmount(formatUnits(amountPerSecond * BigInt(scaleSeconds), decimals)) : ''
  }
  function onRateChange(scaleKey: string, scaleSeconds: number, v: string) {
    setActiveScale(scaleKey)
    setActiveRateText(v)
    try {
      setAmountPerSecond(v && parseFloat(v) > 0 ? perSecondForTotal(parseUnits(v, decimals), scaleSeconds) : 0n)
    } catch {
      /* partial input */
    }
  }

  // ---- Hard-cap table (pivot = capDurationSeconds, derived from the duration cell) ----
  const capDurationSeconds = useMemo(() => {
    const u = DURATION_UNITS.find((d) => d.key === capDurationUnit)
    const n = parseFloat(capDurationN)
    return u && n > 0 ? Math.round(n * u.seconds) : 0
  }, [capDurationN, capDurationUnit])

  const capMaxRaw = useMemo<bigint>(
    () => upfrontRaw + amountPerSecond * BigInt(capDurationSeconds),
    [upfrontRaw, amountPerSecond, capDurationSeconds],
  )
  const capTotalValue = activeTotal !== null ? activeTotal : capDurationSeconds > 0 ? fmt(capMaxRaw) : ''
  function onTotalChange(v: string) {
    setActiveTotal(v)
    try {
      const totalRaw = parseUnits(v, decimals)
      if (amountPerSecond > 0n && totalRaw > upfrontRaw) {
        const secs = Number((totalRaw - upfrontRaw) / amountPerSecond)
        const u = DURATION_UNITS.find((d) => d.key === capDurationUnit)!
        setCapDurationN(trimNum(secs / u.seconds))
      }
    } catch {
      /* partial input */
    }
  }

  // ---- Validation ----
  const rateValid = amountPerSecond > 0n
  const capValid = boundMode === 'revocation' || capDurationSeconds > 0
  const canSign = recipientValid && rateValid && tokenValid && capValid && !signing
  const missing = {
    beneficiary: !recipientValid,
    rate: !rateValid,
    cap: boundMode === 'hardcap' && capDurationSeconds <= 0,
  }

  function resolveMaxRaw(): bigint {
    return boundMode === 'revocation' ? MAX_UINT256 : capMaxRaw
  }

  // ---- Preview (always shown; missing required fields render in red) ----
  const now = Math.floor(Date.now() / 1000)
  const monthlyRate = amountPerSecond > 0n ? fmt(amountPerSecond * BigInt(MONTH)) : ''
  const perSecondStr = amountPerSecond > 0n ? fmt(amountPerSecond) : ''
  const afterOne = amountPerSecond > 0n
    ? fmt(streamedAvailable({
        amountPerSecondRaw: amountPerSecond.toString(),
        initialAmountRaw: upfrontRaw.toString(),
        maxAmountRaw: resolveMaxRaw().toString(),
        startTime: 0,
        nowSeconds: MONTH,
      }))
    : ''
  const capLasts = capDurationSeconds > 0 ? humanDuration(capDurationSeconds) : ''

  async function handleSign() {
    setSigning(true)
    setStep('building')
    setPinnedCid(null)
    setError(null)
    try {
      const delegate = recipient as Address
      const chain = findChain(safe.chainId)
      if (!chain) throw new Error(`Unsupported chain: ${safe.chainId}`)
      const client = createPublicClient({ chain, transport: http() })
      const addrs = getAddresses(safe.chainId)

      const moduleAddress = (await client.readContract({
        address: addrs.delegatorModuleFactory,
        abi: DeleGatorModuleFactoryABI,
        functionName: 'predictAddress',
        args: [safe.safeAddress as Address, DEFAULT_SALT],
      })) as Address

      const environment = getEnvironment(safe.chainId)
      const startTime = Math.floor(Date.now() / 1000)
      const aps = amountPerSecond
      const maxRaw = resolveMaxRaw()
      const ratePerPeriod = fmt(aps * BigInt(MONTH))

      const terms = buildStreamTerms({
        organization: { name: beneficiaryName || 'Beneficiary', recipient: recipient as Address, delegate },
        subscriber: { label: 'Payer', account: safe.safeAddress as Address },
        token: { address: tokenAddress as Address, symbol: tokenSymbol, decimals },
        ratePerPeriod,
        ratePeriodSeconds: MONTH,
        amountPerSecondRaw: aps.toString(),
        initialAmountRaw: upfrontRaw.toString(),
        maxAmountRaw: maxRaw.toString(),
        startTime,
      })
      const agreement = buildStreamAgreement({
        id: `stream_${startTime}_${(safe.safeAddress as string).slice(2, 10).toLowerCase()}`,
        chainId: safe.chainId,
        terms,
      })
      setStep('pinning')
      const jwt = import.meta.env.VITE_PINATA_JWT
      const pin: PinResult = jwt ? await pinStreamAgreement(agreement, jwt) : offlinePinStream(agreement)
      setPinnedCid(pin.cid)

      const sdkDelegation = createDelegation({
        to: delegate,
        from: moduleAddress,
        environment: environment as never,
        scope: {
          type: 'erc20Streaming',
          tokenAddress: tokenAddress as Address,
          initialAmount: upfrontRaw,
          maxAmount: maxRaw,
          amountPerSecond: aps,
          startTime,
        } as never,
        salt: agreement.termsHash,
      }) as { delegate: Address; delegator: Address; authority: Hex; caveats: { enforcer: Address; terms: Hex }[]; salt: Hex }

      const delegation: DelegationStruct = {
        delegate: sdkDelegation.delegate,
        delegator: sdkDelegation.delegator,
        authority: sdkDelegation.authority,
        caveats: sdkDelegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
        salt: sdkDelegation.salt,
        signature: '0x',
      }

      setStep('signing')
      const typedData = buildDelegationTypedData(delegation, safe.chainId)
      const result = (await sdk.txs.signTypedMessage(typedData as never)) as { signature?: Hex; safeTxHash?: Hex }
      const delegationHash = computeDelegationHash(delegation)

      const stored: StoredDelegation = {
        delegation: { ...delegation, signature: (result?.signature || result?.safeTxHash || '0x') as Hex },
        meta: {
          label: beneficiaryName || `${ratePerPeriod} ${tokenSymbol}/month stream`,
          scopeType: 'erc20Streaming',
          createdAt: new Date().toISOString(),
          chainId: safe.chainId,
          safeAddress: safe.safeAddress as Address,
          moduleAddress,
          status: 'signed',
          delegationHash,
          agreement: { cid: pin.cid, uri: pin.uri, termsHash: agreement.termsHash },
          tokenAddress: tokenAddress as Address,
          recipient: recipient as Address,
          amountPerSecond: aps.toString(),
          initialAmount: upfrontRaw.toString(),
          maxAmount: maxRaw.toString(),
          startTime,
          ratePerPeriod,
          ratePeriod: 'month',
        },
      }
      saveDelegation(stored)
      setSigned(stored)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign stream')
    } finally {
      setSigning(false)
      setStep('idle')
    }
  }

  function reset() {
    setSigned(null)
    setBeneficiaryName('')
    setRecipient('')
    setAmountPerSecond(0n)
    setActiveScale(null)
    setActiveRateText('')
    setUpfront('0')
    setBoundMode('revocation')
    setCapDurationN('')
    setCapDurationUnit('month')
    setActiveTotal(null)
    setError(null)
  }

  if (signed) {
    const httpUri = signed.meta.agreement && !signed.meta.agreement.uri.startsWith('ipfs://local-')
      ? ipfsToHttp(signed.meta.agreement.uri)
      : undefined
    const unbounded = signed.meta.maxAmount === MAX_UINT256.toString()
    return (
      <div className="rise max-w-2xl">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: 'rgba(52,211,153,.14)', color: '#34D399' }}>
              <IconCheck size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">Stream signed</h2>
              <p className="text-sm text-dim">Bound on-chain to the IPFS contract. The balance accrues continuously and the beneficiary can claim anytime.</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-raised ring-1 ring-line divide-y divide-line">
            <Row label="Beneficiary"><Payee logo={((signed.meta.recipient ?? signed.delegation.delegate).slice(2, 4)).toUpperCase()} tint="#22D3EE" name={signed.meta.label} addr={short(signed.meta.recipient ?? signed.delegation.delegate)} size={32} /></Row>
            <Row label="Pay rate"><span className="font-mono font-semibold text-ink">{signed.meta.ratePerPeriod} USDC / month</span></Row>
            <Row label="Total"><span className="font-mono text-ink">{unbounded ? 'Unlimited' : `${trimAmount(formatUnits(BigInt(signed.meta.maxAmount ?? '0'), decimals))} USDC`}</span></Row>
            <Row label="Contract hash"><Mono className="text-xs text-dim">{short(signed.meta.agreement!.termsHash)}</Mono></Row>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {httpUri && (
              <a href={httpUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-raised ring-1 ring-line2 px-3 h-9 text-sm text-ink hover:bg-[#212B43] transition">
                <IconCube size={15} /> View IPFS contract <IconExt size={13} className="opacity-60" />
              </a>
            )}
            <CopyChip value={JSON.stringify(signed, null, 2)} label="Copy delegation JSON" />
            <Btn kind="ghost" onClick={reset}>Create another</Btn>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="rise grid grid-cols-1 lg:grid-cols-[1fr_minmax(300px,360px)] gap-6 items-start">
      {/* Form */}
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">New stream</h1>
          <p className="text-dim text-sm mt-1">Pay continuously. The balance accrues every second and can be claimed anytime.</p>
        </div>

        {error && (
          <div className="rounded-xl px-3 py-2 text-sm text-danger" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}>
            {error}
          </div>
        )}

        {/* Block 1 — Beneficiary */}
        <Block title="Beneficiary">
          <Field label="Name" hint="Shown in your streams list. Optional.">
            <input type="text" placeholder="Jane Doe" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} />
          </Field>
          <Field label="Address" required missing={missing.beneficiary} hint="Who can claim, and where funds are paid.">
            <input type="text" placeholder="0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} className={missing.beneficiary ? 'ring-1 ring-danger' : ''} />
            {recipient && !recipientValid && <p className="text-xs text-danger mt-1">Invalid address</p>}
          </Field>
        </Block>

        {/* Block 2 — Payment details */}
        <Block title="Payment details">
          <Field label="Token">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setUseCustomToken(false)} className={`flex-1 h-11 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition ${!useCustomToken ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink'}`}>
                <USDC size={15} />
              </button>
              <button type="button" onClick={() => setUseCustomToken(true)} className={`flex-1 h-11 rounded-xl text-sm font-medium transition ${useCustomToken ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink'}`}>
                Custom ERC-20
              </button>
            </div>
            {!useCustomToken && defaultUsdc && <p className="text-xs text-faint font-mono mt-2 truncate">{defaultUsdc}</p>}
            {useCustomToken && (
              <div className="grid grid-cols-[1fr_88px] gap-2 mt-2">
                <input type="text" placeholder="Token 0x…" value={customToken} onChange={(e) => setCustomToken(e.target.value)} />
                <input type="number" placeholder="6" value={customDecimals} onChange={(e) => setCustomDecimals(parseInt(e.target.value) || 6)} min={0} max={24} />
              </div>
            )}
          </Field>

          <Field label="Pay rate" required missing={missing.rate} hint="The same flow shown at three scales. Edit any one — the others follow.">
            <div className="grid grid-cols-3 gap-2">
              {RATE_SCALES.map((s) => (
                <div key={s.key}>
                  <div className="text-[11px] text-faint mb-1">{s.label}</div>
                  <div className="relative">
                    <input
                      type="number" min={0} step="any" placeholder="0"
                      value={rateCellValue(s.key, s.seconds)}
                      onChange={(e) => onRateChange(s.key, s.seconds, e.target.value)}
                      onBlur={() => setActiveScale(null)}
                      className={`pr-12 ${missing.rate ? 'ring-1 ring-danger' : ''}`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-faint">{tokenSymbol}</span>
                  </div>
                </div>
              ))}
            </div>
            {perSecondStr && <p className="text-[11px] text-faint font-mono mt-2">≈ {perSecondStr} {tokenSymbol}/s</p>}
          </Field>

          <Field label="Upfront payment" hint="Paid immediately at stream start. Optional.">
            <div className="relative">
              <input type="number" placeholder="0" value={upfront} onChange={(e) => setUpfront(e.target.value)} min={0} step="any" className="pr-16" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
            </div>
          </Field>
        </Block>

        {/* Block 3 — Security / limit */}
        <Block title="Security / limit">
          <Field label="Limit" hint="By default the stream runs until you revoke it. Add a hard cap to bound the total.">
            <div className="flex items-center gap-2">
              {([['revocation', 'Revocation only'], ['hardcap', 'Hard cap']] as [BoundMode, string][]).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setBoundMode(key)} className={`flex-1 h-11 rounded-xl text-sm font-medium transition ${boundMode === key ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>

            {boundMode === 'hardcap' && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[11px] text-faint mb-1">End date</div>
                  <input type="text" readOnly value={capDurationSeconds > 0 ? dateStr(now + capDurationSeconds) : '—'} className="text-dim" />
                </div>
                <div>
                  <div className="text-[11px] text-faint mb-1">Duration</div>
                  <div className="grid grid-cols-[1fr_auto] gap-1">
                    <input type="number" min={0} step="any" placeholder="3" value={capDurationN} onChange={(e) => setCapDurationN(e.target.value)} className={missing.cap ? 'ring-1 ring-danger' : ''} />
                    <select value={capDurationUnit} onChange={(e) => setCapDurationUnit(e.target.value)} className="w-auto">
                      {DURATION_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-faint mb-1">Total budget</div>
                  <div className="relative">
                    <input type="number" min={0} step="any" placeholder="900" value={capTotalValue} onChange={(e) => onTotalChange(e.target.value)} onBlur={() => setActiveTotal(null)} className={`pr-12 ${missing.cap ? 'ring-1 ring-danger' : ''}`} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-faint">{tokenSymbol}</span>
                  </div>
                </div>
                {capLasts && <p className="text-[11px] text-faint col-span-3">Fully vested in ~{capLasts}, by {dateStr(now + capDurationSeconds)}.</p>}
              </div>
            )}
          </Field>
        </Block>
      </div>

      {/* Stream preview — always full; missing required fields show in red */}
      <Card className="p-5 lg:sticky lg:top-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-faint uppercase tracking-wide"><IconRepeat size={15} /> Stream preview</div>

        <div className="mt-4 space-y-3 text-sm">
          <PreviewRow label="Payer"><Mono className="text-xs text-dim">{short(safe.safeAddress)}</Mono></PreviewRow>
          <PreviewRow label="Beneficiary">
            <span className="text-ink truncate">{beneficiaryName || 'Beneficiary'}</span>
            {recipientValid ? <Mono className="text-[11px] text-faint block">{short(recipient)}</Mono> : <span className="text-[11px] text-danger block">address required</span>}
          </PreviewRow>
          <div className="rounded-xl bg-raised ring-1 ring-line p-3">
            <div className="text-faint text-xs">Accrues</div>
            {rateValid ? (
              <>
                <div className="font-mono font-bold text-ink tnum mt-0.5" style={{ fontSize: 22 }}>{monthlyRate} <span className="text-dim text-sm font-semibold">{tokenSymbol} / month</span></div>
                <div className="text-faint text-[11px] mt-1 font-mono">≈ {perSecondStr} {tokenSymbol}/s</div>
              </>
            ) : (
              <div className="text-danger text-sm font-semibold mt-0.5">pay rate required</div>
            )}
          </div>
          <PreviewRow label="Upfront"><span className="font-mono text-ink">{trimAmount(upfront || '0')} {tokenSymbol}</span></PreviewRow>
          <PreviewRow label={<span className="flex items-center gap-1"><IconLock size={12} /> Limit</span>}>
            {boundMode === 'revocation' ? (
              <>
                <span className="font-mono text-ink">Unlimited</span>
                <span className="text-faint text-[11px] block">runs until revoked</span>
              </>
            ) : capDurationSeconds > 0 ? (
              <>
                <span className="font-mono text-ink">{fmt(capMaxRaw)} {tokenSymbol}</span>
                <span className="text-faint text-[11px] block">by {dateStr(now + capDurationSeconds)}</span>
              </>
            ) : (
              <span className="text-danger text-[11px]">cap duration required</span>
            )}
          </PreviewRow>
          {rateValid && (
            <PreviewRow label="After one month"><span className="font-mono text-ink">{afterOne} {tokenSymbol}</span></PreviewRow>
          )}
          <div className="pt-3 border-t border-line">
            <p className="text-[11px] text-faint leading-relaxed">Unclaimed balance keeps accruing, nothing is forfeited. The <span className="text-dim">erc20Streaming</span> caveat caps every claim on-chain.</p>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-line space-y-3">
          {step === 'idle' ? (
            <>
              <div className="flex items-center gap-2 text-xs text-dim">
                <IconCube size={14} style={{ color: 'var(--accent)' }} /> Pinned to IPFS, hash bound to your signature.
              </div>
              <GaslessButton size="lg" onClick={handleSign} disabled={!canSign} className="w-full">Pin &amp; sign</GaslessButton>
              {!canSign && <p className="text-[11px] text-faint text-center">Fill the fields marked in red to sign.</p>}
            </>
          ) : (
            <div className="space-y-2 py-1 text-xs text-dim">
              <div className="flex items-center gap-2"><IconHash size={12} /> {step === 'building' ? 'Building contract…' : step === 'pinning' ? `Pinning to IPFS${pinnedCid ? ` · ${short(pinnedCid)}` : '…'}` : 'Waiting for Safe signature…'}</div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-faint uppercase tracking-wide"><IconCal size={14} /> {title}</div>
      {children}
    </Card>
  )
}

function Field({ label, hint, required, missing, children }: { label: string; hint?: string; required?: boolean; missing?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1.5">
        <span className="text-ink">{label}</span>
        {required && <span className={missing ? 'text-danger ml-1' : 'text-faint ml-1'}>*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-faint mt-1">{hint}</p>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-faint">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}

function PreviewRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-faint mt-0.5">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}
