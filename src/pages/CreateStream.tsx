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
  ratePerSecondRaw,
  streamedAvailable,
} from '../lib/streamTerms'
import { periodToSeconds, periodLabel, type PeriodType } from '../lib/enforcers'
import { getEnvironment } from '../lib/environment'
import { saveDelegation, type StoredDelegation } from '../lib/storage'
import { Card, Btn, GaslessButton, USDC, Mono, CopyChip, Payee } from '../ui/components'
import { IconCube, IconLock, IconCheck, IconExt, IconHash, IconRepeat } from '../ui/icons'

const chains: Record<number, typeof baseSepolia | typeof base | typeof sepolia> = { 84532: baseSepolia, 11155111: sepolia, 8453: base }

const USDC_BY_CHAIN: Record<number, Address> = {
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
}
const PERIODS: PeriodType[] = ['minutely', 'hourly', 'daily', 'weekly', 'monthly']
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

type SignStep = 'idle' | 'building' | 'pinning' | 'signing'

export default function CreateStream() {
  const { sdk, safe } = useSafeAppsSDK()

  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [recipient, setRecipient] = useState('')
  const [rate, setRate] = useState('')
  const [ratePeriod, setRatePeriod] = useState<PeriodType>('monthly')
  const [initialAmount, setInitialAmount] = useState('0')
  const [maxAmount, setMaxAmount] = useState('')
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
  const tokenDecimals = useCustomToken ? customDecimals : 6
  const tokenSymbol = useCustomToken ? 'tokens' : 'USDC'

  const rateValid = !!rate && parseFloat(rate) > 0
  const maxValid = !!maxAmount && parseFloat(maxAmount) > 0
  // The enforcer reverts unless maxAmount >= initialAmount.
  const capBelowInitial = maxValid && parseFloat(maxAmount) < parseFloat(initialAmount || '0')
  const recipientValid = isAddress(recipient)
  const tokenValid = !!tokenAddress && isAddress(tokenAddress)
  const canSign = rateValid && maxValid && !capBelowInitial && recipientValid && tokenValid && !signing

  // Live accrual preview — what the beneficiary can claim after one full period,
  // and the implied per-second rate, so the accumulating nature is tangible.
  const preview = useMemo(() => {
    if (!rateValid || !maxValid || !tokenValid) return null
    try {
      const periodSeconds = Number(periodToSeconds(ratePeriod))
      const aps = ratePerSecondRaw(rate, periodSeconds, tokenDecimals)
      const init = parseUnits(initialAmount || '0', tokenDecimals)
      const max = parseUnits(maxAmount, tokenDecimals)
      const afterOnePeriod = streamedAvailable({
        amountPerSecondRaw: aps.toString(),
        initialAmountRaw: init.toString(),
        maxAmountRaw: max.toString(),
        startTime: 0,
        nowSeconds: periodSeconds,
      })
      const secondsToCap = aps > 0n ? Number((max - init > 0n ? max - init : 0n) / aps) : 0
      return {
        amountPerSecond: formatUnits(aps, tokenDecimals),
        afterOnePeriod: formatUnits(afterOnePeriod, tokenDecimals),
        daysToCap: secondsToCap > 0 ? Math.ceil(secondsToCap / 86400) : 0,
      }
    } catch {
      return null
    }
  }, [rate, rateValid, maxValid, tokenValid, ratePeriod, initialAmount, maxAmount, tokenDecimals])

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
      const periodSeconds = Number(periodToSeconds(ratePeriod))

      // Pin the human-readable contract and bind the signature to it: salt = keccak256(terms).
      const terms = buildStreamTerms({
        organization: { name: beneficiaryName || 'Beneficiary', recipient: recipient as Address, delegate },
        subscriber: { label: 'Safe', account: safe.safeAddress as Address },
        token: { address: tokenAddress as Address, symbol: tokenSymbol, decimals: tokenDecimals },
        ratePerPeriod: rate,
        ratePeriodSeconds: periodSeconds,
        initialAmount: initialAmount || '0',
        maxAmount,
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

      const amountPerSecond = ratePerSecondRaw(rate, periodSeconds, tokenDecimals)
      const initialRaw = parseUnits(initialAmount || '0', tokenDecimals)
      const maxRaw = parseUnits(maxAmount, tokenDecimals)

      const sdkDelegation = createDelegation({
        to: delegate,
        from: moduleAddress,
        environment: environment as never,
        scope: {
          type: 'erc20Streaming',
          tokenAddress: tokenAddress as Address,
          initialAmount: initialRaw,
          maxAmount: maxRaw,
          amountPerSecond,
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
          label: beneficiaryName || `${rate} ${tokenSymbol} ${periodLabel(ratePeriod)} stream`,
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
          amountPerSecond: amountPerSecond.toString(),
          initialAmount: initialRaw.toString(),
          maxAmount: maxRaw.toString(),
          startTime: now,
          ratePerPeriod: rate,
          ratePeriod,
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
    setRatePeriod('monthly')
    setInitialAmount('0')
    setMaxAmount('')
    setError(null)
  }

  if (signed) {
    const httpUri = signed.meta.agreement && !signed.meta.agreement.uri.startsWith('ipfs://local-')
      ? ipfsToHttp(signed.meta.agreement.uri)
      : undefined
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
            <Row label="Total budget"><span className="font-mono text-ink">{maxAmount} USDC</span></Row>
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

          <div className="grid grid-cols-[1fr_120px] gap-4">
            <Field label="Pay rate" hint="How fast the balance accrues.">
              <div className="relative">
                <input type="number" placeholder="1000" value={rate} onChange={(e) => setRate(e.target.value)} min={0} step="any" className="pr-16" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
              </div>
            </Field>
            <Field label="Per">
              <select value={ratePeriod} onChange={(e) => setRatePeriod(e.target.value as PeriodType)}>
                {PERIODS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Total budget" hint="The most that will ever be paid out — the stream stops here. Required, and must be ≥ the upfront amount.">
            <div className="relative">
              <input type="number" placeholder="12000" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} min={0} step="any" className="pr-16" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
            </div>
            {capBelowInitial && <p className="text-xs text-danger mt-1">Total budget must be ≥ the upfront amount.</p>}
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
                {rate} <span className="text-dim text-sm font-semibold">{tokenSymbol} / {ratePeriod.replace('ly', '')}</span>
              </div>
              <div className="text-faint text-[11px] mt-1 font-mono">≈ {preview.amountPerSecond} {tokenSymbol}/s</div>
            </div>
            <PreviewRow label={<span className="flex items-center gap-1"><IconLock size={12} /> After one {ratePeriod.replace('ly', '')}</span>}>
              <span className="font-mono text-ink">{preview.afterOnePeriod} {tokenSymbol}</span>
              <span className="text-faint text-[11px] block">claimable, accumulating</span>
            </PreviewRow>
            <PreviewRow label="Total budget">
              <span className="font-mono text-ink">{maxAmount} {tokenSymbol}</span>
              {preview.daysToCap > 0 && <span className="text-faint text-[11px] block">reached in ~{preview.daysToCap} d</span>}
            </PreviewRow>
            <div className="pt-3 border-t border-line">
              <p className="text-[11px] text-faint leading-relaxed">Unclaimed balance keeps accruing — if the beneficiary can't claim for a while, nothing is forfeited. The <span className="text-dim">erc20Streaming</span> caveat caps every claim on-chain.</p>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-dim leading-relaxed">Fill in a rate, a cap and a valid token to preview the stream that gets pinned to IPFS and bound to your signature.</p>
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
