import { useMemo, useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, isAddress, parseUnits, formatUnits, type Address, type Hex } from 'viem'
import { baseSepolia, base, sepolia } from 'viem/chains'
import { createDelegation } from '@metamask/smart-accounts-kit'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
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
import {
  RATE_UNITS,
  MAX_UINT256,
  rateToPerSecond,
  convertRate,
  rateBreakdown,
  secondsToBudget,
  budgetByEndTime,
  humanDuration,
  unitSeconds,
  type RateUnitKey,
} from '../lib/streamRate'
import { getEnvironment } from '../lib/environment'
import { saveDelegation, type StoredDelegation } from '../lib/storage'
import { Card, Btn, GaslessButton, USDC, Mono, CopyChip, Payee } from '../ui/components'
import { IconCube, IconLock, IconCheck, IconExt, IconHash, IconRepeat, IconCal } from '../ui/icons'

const chains: Record<number, typeof baseSepolia | typeof base | typeof sepolia> = { 84532: baseSepolia, 11155111: sepolia, 8453: base }

const USDC_BY_CHAIN: Record<number, Address> = {
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const trimAmount = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)

type SignStep = 'idle' | 'building' | 'pinning' | 'signing'
type BoundMode = 'unbounded' | 'budget' | 'enddate'

const BOUND_MODES: { key: BoundMode; label: string }[] = [
  { key: 'unbounded', label: 'Until revoked' },
  { key: 'budget', label: 'Total budget' },
  { key: 'enddate', label: 'End date' },
]

export default function CreateStream() {
  const { sdk, safe } = useSafeAppsSDK()

  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [recipient, setRecipient] = useState('')
  const [rate, setRate] = useState('')
  const [rateUnit, setRateUnit] = useState<RateUnitKey>('month')
  const [boundMode, setBoundMode] = useState<BoundMode>('unbounded')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [endDate, setEndDate] = useState('')
  const [initialAmount, setInitialAmount] = useState('0')
  const [useCustomToken, setUseCustomToken] = useState(false)
  const [customToken, setCustomToken] = useState('')
  const [customDecimals, setCustomDecimals] = useState(6)

  const [signing, setSigning] = useState(false)
  const [step, setStep] = useState<SignStep>('idle')
  const [pinnedCid, setPinnedCid] = useState<string | null>(null)
  const [signed, setSigned] = useState<StoredDelegation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const defaultUsdc = USDC_BY_CHAIN[safe.chainId]
  const tokenAddress = useCustomToken ? customToken : defaultUsdc
  const decimals = useCustomToken ? customDecimals : 6
  const tokenSymbol = useCustomToken ? 'tokens' : 'USDC'

  const rateValid = !!rate && parseFloat(rate) > 0
  const recipientValid = isAddress(recipient)
  const tokenValid = !!tokenAddress && isAddress(tokenAddress)

  // Per-second flow is the on-chain truth; the unit is only a display scale.
  const amountPerSecond = useMemo<bigint>(() => {
    if (!rateValid || !tokenValid) return 0n
    try { return rateToPerSecond(rate, rateUnit, decimals) } catch { return 0n }
  }, [rate, rateValid, tokenValid, rateUnit, decimals])

  const initialRaw = useMemo<bigint>(() => {
    try { return parseUnits(initialAmount || '0', decimals) } catch { return 0n }
  }, [initialAmount, decimals])

  const budgetRaw = useMemo<bigint>(() => {
    if (boundMode !== 'budget' || !budgetAmount) return 0n
    try { return parseUnits(budgetAmount, decimals) } catch { return 0n }
  }, [boundMode, budgetAmount, decimals])

  const budgetBelowInitial = boundMode === 'budget' && !!budgetAmount && budgetRaw < initialRaw
  const budgetValid = boundMode !== 'budget' || (parseFloat(budgetAmount) > 0 && !budgetBelowInitial)
  const endValid = boundMode !== 'enddate' || (!!endDate && new Date(endDate).getTime() / 1000 > Math.floor(Date.now() / 1000))
  const canSign = rateValid && amountPerSecond > 0n && recipientValid && tokenValid && budgetValid && endValid && !signing

  // Changing the unit re-expresses the same flow at the new scale (same per-second).
  function changeUnit(next: RateUnitKey) {
    if (rate) setRate(trimAmount(convertRate(rate, rateUnit, next)))
    setRateUnit(next)
  }

  // Resolve the enforcer maxAmount for the chosen bound mode at timestamp `now`.
  function resolveMaxRaw(now: number): bigint {
    if (boundMode === 'budget') return budgetRaw
    if (boundMode === 'enddate') {
      const endSec = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : now
      return budgetByEndTime(amountPerSecond, now, endSec, initialRaw)
    }
    return MAX_UINT256
  }

  const preview = useMemo(() => {
    if (!rateValid || !tokenValid || amountPerSecond <= 0n) return null
    const now = Math.floor(Date.now() / 1000)
    const maxRaw = resolveMaxRaw(now)
    const bd = rateBreakdown(amountPerSecond, decimals)
    const afterOne = streamedAvailable({
      amountPerSecondRaw: amountPerSecond.toString(),
      initialAmountRaw: initialRaw.toString(),
      maxAmountRaw: maxRaw.toString(),
      startTime: 0,
      nowSeconds: unitSeconds(rateUnit),
    })
    return {
      perSecond: bd.second,
      perDay: bd.day,
      perMonth: bd.month,
      afterOne: formatUnits(afterOne, decimals),
      unbounded: boundMode === 'unbounded',
      budgetStr: boundMode === 'unbounded' ? null : trimAmount(formatUnits(maxRaw, decimals)),
      lasts: boundMode === 'unbounded' ? null : humanDuration(secondsToBudget(amountPerSecond, maxRaw, initialRaw)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateValid, tokenValid, amountPerSecond, boundMode, budgetRaw, endDate, initialRaw, rateUnit, decimals])

  async function handleSign() {
    setSigning(true)
    setStep('building')
    setPinnedCid(null)
    setError(null)
    try {
      const delegate = recipient as Address
      const chain = chains[safe.chainId]
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
      const now = Math.floor(Date.now() / 1000)
      const aps = rateToPerSecond(rate, rateUnit, decimals)
      const maxRaw = resolveMaxRaw(now)

      // Pin the human-readable contract and bind the signature to it: salt = keccak256(terms).
      const terms = buildStreamTerms({
        organization: { name: beneficiaryName || 'Beneficiary', recipient: recipient as Address, delegate },
        subscriber: { label: 'Safe', account: safe.safeAddress as Address },
        token: { address: tokenAddress as Address, symbol: tokenSymbol, decimals },
        ratePerPeriod: rate,
        ratePeriodSeconds: unitSeconds(rateUnit),
        amountPerSecondRaw: aps.toString(),
        initialAmountRaw: initialRaw.toString(),
        maxAmountRaw: maxRaw.toString(),
        startTime: now,
      })
      const agreement = buildStreamAgreement({
        id: `stream_${now}_${(safe.safeAddress as string).slice(2, 10).toLowerCase()}`,
        chainId: safe.chainId,
        terms,
      })
      setStep('pinning')
      const jwt = import.meta.env.VITE_PINATA_JWT
      const pin: PinResult = jwt ? await pinStreamAgreement(agreement, jwt) : offlinePinStream(agreement)
      setPinnedCid(pin.cid)
      const salt = agreement.termsHash

      const sdkDelegation = createDelegation({
        to: delegate,
        from: moduleAddress,
        environment: environment as never,
        scope: {
          type: 'erc20Streaming',
          tokenAddress: tokenAddress as Address,
          initialAmount: initialRaw,
          maxAmount: maxRaw,
          amountPerSecond: aps,
          startTime: now,
        } as never,
        salt,
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
          label: beneficiaryName || `${rate} ${tokenSymbol}/${rateUnit} stream`,
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
          initialAmount: initialRaw.toString(),
          maxAmount: maxRaw.toString(),
          startTime: now,
          ratePerPeriod: rate,
          ratePeriod: rateUnit,
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
    setRate('')
    setRateUnit('month')
    setBoundMode('unbounded')
    setBudgetAmount('')
    setEndDate('')
    setInitialAmount('0')
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
            <Row label="Pay rate"><span className="font-mono font-semibold text-ink">{signed.meta.ratePerPeriod} USDC / {signed.meta.ratePeriod}</span></Row>
            <Row label="Total budget"><span className="font-mono text-ink">{unbounded ? 'Unlimited' : `${trimAmount(formatUnits(BigInt(signed.meta.maxAmount ?? '0'), decimals))} USDC`}</span></Row>
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
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">New stream</h1>
        <p className="text-dim text-sm mt-1">Pay continuously. The balance accrues every second and the beneficiary claims whenever — nothing is lost if they wait.</p>

        {error && (
          <div className="mt-4 rounded-xl px-3 py-2 text-sm text-danger" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}>
            {error}
          </div>
        )}

        <Card className="p-5 mt-5 space-y-5">
          <Field label="Beneficiary name" hint="Shown in your streams list. Optional.">
            <input type="text" placeholder="Jane Doe" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} />
          </Field>

          <Field label="Beneficiary address" hint="The account allowed to claim (the delegate) and where funds are paid.">
            <input type="text" placeholder="0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            {recipient && !recipientValid && <p className="text-xs text-danger mt-1">Invalid address</p>}
          </Field>

          <Field label="Pay rate" hint="The flow is the same money — only the scale changes. Switch the unit to see it re-expressed.">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="relative">
                <input type="number" placeholder="1000" value={rate} onChange={(e) => setRate(e.target.value)} min={0} step="any" className="pr-16" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
              </div>
              <select value={rateUnit} onChange={(e) => changeUnit(e.target.value as RateUnitKey)}>
                {RATE_UNITS.map((u) => <option key={u.key} value={u.key}>per {u.label.toLowerCase()}</option>)}
              </select>
            </div>
            {preview && (
              <p className="text-[11px] text-faint font-mono mt-2">
                ≈ {preview.perSecond} {tokenSymbol}/s · {trimAmount(preview.perDay)}/day · {trimAmount(preview.perMonth)}/month
              </p>
            )}
          </Field>

          <Field label="Limit" hint="By default the stream runs at its rate until you revoke it. Cap the total or set an end date if you want it to stop on its own.">
            <div className="flex items-center gap-2">
              {BOUND_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setBoundMode(m.key)}
                  className={`flex-1 h-11 rounded-xl text-sm font-medium transition ${boundMode === m.key ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {boundMode === 'budget' && (
              <div className="mt-3">
                <div className="relative">
                  <input type="number" placeholder="12000" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} min={0} step="any" className="pr-16" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
                </div>
                {budgetBelowInitial && <p className="text-xs text-danger mt-1">Total budget must be ≥ the upfront amount.</p>}
                {budgetValid && preview?.lasts && (
                  <p className="text-[11px] text-pending mt-2">At this rate the budget lasts ~{preview.lasts} — you'll need to sign a new stream after that to keep paying.</p>
                )}
              </div>
            )}

            {boundMode === 'enddate' && (
              <div className="mt-3">
                <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                {endValid && preview?.budgetStr && (
                  <p className="text-[11px] text-faint mt-2 flex items-center gap-1"><IconCal size={11} /> Total paid by then ≈ {preview.budgetStr} {tokenSymbol} — that becomes the on-chain cap.</p>
                )}
              </div>
            )}
          </Field>

          <Field label="Upfront amount" hint="Paid immediately at start (e.g. a signing advance). Optional — defaults to 0.">
            <div className="relative">
              <input type="number" placeholder="0" value={initialAmount} onChange={(e) => setInitialAmount(e.target.value)} min={0} step="any" className="pr-16" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
            </div>
          </Field>

          <Field label="Token">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setUseCustomToken(false)}
                className={`flex-1 h-11 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition ${!useCustomToken ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink'}`}
              >
                <USDC size={15} />
              </button>
              <button
                type="button"
                onClick={() => setUseCustomToken(true)}
                className={`flex-1 h-11 rounded-xl text-sm font-medium transition ${useCustomToken ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink'}`}
              >
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
        </Card>
      </div>

      {/* Live accrual preview */}
      <Card className="p-5 lg:sticky lg:top-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-faint uppercase tracking-wide"><IconRepeat size={15} /> Stream preview</div>
          {!preview && <span className="text-xs text-faint">Incomplete</span>}
        </div>

        {preview ? (
          <div className="mt-4 space-y-3 text-sm">
            <PreviewRow label="Subscriber"><Mono className="text-xs text-dim">{short(safe.safeAddress)}</Mono></PreviewRow>
            <PreviewRow label="Beneficiary">
              <span className="text-ink truncate">{beneficiaryName || 'Beneficiary'}</span>
              {recipientValid && <Mono className="text-[11px] text-faint block">{short(recipient)}</Mono>}
            </PreviewRow>
            <div className="rounded-xl bg-raised ring-1 ring-line p-3">
              <div className="text-faint text-xs">Accrues</div>
              <div className="font-mono font-bold text-ink tnum mt-0.5" style={{ fontSize: 22 }}>
                {rate} <span className="text-dim text-sm font-semibold">{tokenSymbol} / {rateUnit}</span>
              </div>
              <div className="text-faint text-[11px] mt-1 font-mono">≈ {preview.perSecond} {tokenSymbol}/s</div>
            </div>
            <PreviewRow label={<span className="flex items-center gap-1"><IconLock size={12} /> After one {rateUnit}</span>}>
              <span className="font-mono text-ink">{trimAmount(preview.afterOne)} {tokenSymbol}</span>
              <span className="text-faint text-[11px] block">claimable, accumulating</span>
            </PreviewRow>
            <PreviewRow label="Total budget">
              {preview.unbounded ? (
                <>
                  <span className="font-mono text-ink">Unlimited</span>
                  <span className="text-faint text-[11px] block">runs until revoked</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-ink">{preview.budgetStr} {tokenSymbol}</span>
                  {preview.lasts && <span className="text-faint text-[11px] block">lasts ~{preview.lasts}</span>}
                </>
              )}
            </PreviewRow>
            <div className="pt-3 border-t border-line">
              <p className="text-[11px] text-faint leading-relaxed">Unclaimed balance keeps accruing — if the beneficiary can't claim for a while, nothing is forfeited. The <span className="text-dim">erc20Streaming</span> caveat caps every claim on-chain.</p>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-dim leading-relaxed">Fill in a pay rate and a valid token to preview the stream that gets pinned to IPFS and bound to your signature.</p>
        )}

        {preview && (
          <div className="mt-5 pt-4 border-t border-line space-y-3">
            {step === 'idle' ? (
              <>
                <div className="flex items-center gap-2 text-xs text-dim">
                  <IconCube size={14} style={{ color: 'var(--accent)' }} /> Pinned to IPFS, hash bound to your signature.
                </div>
                <GaslessButton size="lg" onClick={handleSign} disabled={!canSign} className="w-full">
                  Pin & sign
                </GaslessButton>
                <p className="text-[11px] text-faint text-center">1 signature</p>
              </>
            ) : (
              <div className="space-y-2 py-1 text-xs text-dim">
                <div className="flex items-center gap-2"><IconHash size={12} /> {step === 'building' ? 'Building contract…' : step === 'pinning' ? `Pinning to IPFS${pinnedCid ? ` · ${short(pinnedCid)}` : '…'}` : 'Waiting for Safe signature…'}</div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-1.5">{label}</label>
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
