import { useEffect, useMemo, useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, isAddress, parseUnits, type Address, type Hex } from 'viem'
import { createDelegation } from '@metamask/smart-accounts-kit'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { DEFAULT_SALT } from '../lib/module'
import { buildDelegationTypedData, computeDelegationHash, type DelegationStruct } from '../lib/delegations'
import {
  buildTerms,
  buildAgreementDocument,
  pinAgreement,
  offlinePin,
  ipfsToHttp,
  type AgreementDocument,
  type PinResult,
} from '../lib/subscriptionTerms'
import { periodToSeconds, periodLabel, periodNoun, type PeriodType } from '../lib/enforcers'
import { getEnvironment } from '../lib/environment'
import { saveDelegation, setDelegationIntuition, type StoredDelegation } from '../lib/storage'
import { usePublishToIntuition } from '../hooks/usePublishToIntuition'
import { OrgPicker } from '../ui/OrgPicker'
import { orgSelectionToInput, type OrgSelection } from '../lib/orgSelection'
import { Card, Btn, GaslessButton, USDC, Mono, CopyChip, Payee, StatusBadge } from '../ui/components'
import { IconCube, IconLock, IconCheck, IconExt, IconHash, IconCal } from '../ui/icons'
import { findChain, USDC_ADDRESS, rpcUrl } from '../config/supported-chains'

const PERIODS: PeriodType[] = ['minutely', 'daily', 'weekly', 'monthly']
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

type SignStep = 'idle' | 'building' | 'pinning' | 'signing'

function StepRow({ done, active, label, sub }: { done?: boolean; active?: boolean; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid place-items-center w-6 h-6 rounded-full shrink-0 transition"
        style={{
          background: done ? 'rgba(52,211,153,.16)' : active ? 'var(--accent-soft)' : '#1A2236',
          color: done ? '#34D399' : active ? 'var(--accent)' : '#646E86',
          boxShadow: active ? '0 0 0 1px var(--accent-line)' : 'none',
        }}
      >
        {done ? (
          <IconCheck size={14} />
        ) : active ? (
          <span className="w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
        )}
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${done || active ? 'text-ink' : 'text-faint'}`}>{label}</div>
        {sub && <div className="text-[11px] font-mono text-faint truncate">{sub}</div>}
      </div>
    </div>
  )
}

export default function CreateDelegation() {
  const { sdk, safe } = useSafeAppsSDK()

  const [payeeName, setPayeeName] = useState('')
  const [org, setOrg] = useState<OrgSelection>(null)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState<PeriodType>('monthly')
  const [useCustomToken, setUseCustomToken] = useState(false)
  const [customToken, setCustomToken] = useState('')
  const [customDecimals, setCustomDecimals] = useState(6)
  const [expiryEnabled, setExpiryEnabled] = useState(false)
  const [expiryDate, setExpiryDate] = useState('')

  const [signing, setSigning] = useState(false)
  const [step, setStep] = useState<SignStep>('idle')
  const [pinnedCid, setPinnedCid] = useState<string | null>(null)
  const [signed, setSigned] = useState<StoredDelegation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { publish: publishToIntuition, status: intuitionStatus, enabled: intuitionEnabled } =
    usePublishToIntuition()

  // Persist the published DelegationJson atom so the overview can deep-link to the
  // Intuition portal instead of the (possibly offline) IPFS link.
  useEffect(() => {
    if (signed && intuitionStatus.state === 'done' && intuitionStatus.atomId && intuitionStatus.network) {
      setDelegationIntuition(signed.meta.delegationHash, {
        atomId: intuitionStatus.atomId,
        network: intuitionStatus.network,
      })
    }
  }, [signed, intuitionStatus])

  const defaultUsdc = USDC_ADDRESS[safe.chainId]
  const tokenAddress = useCustomToken ? customToken : defaultUsdc
  const tokenDecimals = useCustomToken ? customDecimals : 6
  const tokenSymbol = useCustomToken ? 'tokens' : 'USDC'

  const amountValid = !!amount && parseFloat(amount) > 0
  const recipientValid = isAddress(recipient)
  const tokenValid = !!tokenAddress && isAddress(tokenAddress)
  const expiryValid = !expiryEnabled || !!expiryDate
  const canSign = amountValid && recipientValid && tokenValid && expiryValid && !signing

  // Live agreement preview — recomputed as the form changes, so the contract
  // hash the subscriber commits to is visible before signing.
  const preview = useMemo<AgreementDocument | null>(() => {
    if (!amountValid || !tokenValid || !recipientValid) return null
    try {
      const terms = buildTerms({
        organization: { name: payeeName || 'Organization', recipient: recipient as Address, delegate: recipient as Address },
        subscriber: { label: 'Safe', account: safe.safeAddress as Address },
        token: { address: tokenAddress as Address, symbol: tokenSymbol, decimals: tokenDecimals },
        amountPerPeriod: amount,
        periodSeconds: Number(periodToSeconds(period)),
        endDate: expiryEnabled && expiryDate ? Math.floor(new Date(expiryDate).getTime() / 1000) : null,
      })
      return buildAgreementDocument({ id: 'preview', chainId: safe.chainId, terms })
    } catch {
      return null
    }
  }, [amount, amountValid, tokenValid, recipientValid, tokenAddress, tokenDecimals, tokenSymbol, payeeName, recipient, period, expiryEnabled, expiryDate, safe.chainId, safe.safeAddress])

  async function handleSign() {
    setSigning(true)
    setStep('building')
    setPinnedCid(null)
    setError(null)
    try {
      // The payee is the delegate: it redeems the delegation directly on-chain.
      const delegate = recipient as Address
      const chain = findChain(safe.chainId)
      if (!chain) throw new Error(`Unsupported chain: ${safe.chainId}`)
      const client = createPublicClient({ chain, transport: http(rpcUrl(safe.chainId)) })
      const addrs = getAddresses(safe.chainId)

      const moduleAddress = (await client.readContract({
        address: addrs.delegatorModuleFactory,
        abi: DeleGatorModuleFactoryABI,
        functionName: 'predictAddress',
        args: [safe.safeAddress as Address, DEFAULT_SALT],
      })) as Address

      const environment = getEnvironment(safe.chainId)
      const now = Math.floor(Date.now() / 1000)
      const expiryTs = expiryEnabled && expiryDate ? Math.floor(new Date(expiryDate).getTime() / 1000) : undefined

      // Pin the human-readable contract and bind the signature to it: salt = keccak256(terms).
      const terms = buildTerms({
        organization: { name: payeeName || 'Organization', recipient: recipient as Address, delegate },
        subscriber: { label: 'Safe', account: safe.safeAddress as Address },
        token: { address: tokenAddress as Address, symbol: tokenSymbol, decimals: tokenDecimals },
        amountPerPeriod: amount,
        periodSeconds: Number(periodToSeconds(period)),
        startDate: now,
        endDate: expiryTs ?? null,
      })
      const agreement = buildAgreementDocument({
        id: `sub_${now}_${(safe.safeAddress as string).slice(2, 10).toLowerCase()}`,
        chainId: safe.chainId,
        terms,
      })
      setStep('pinning')
      const jwt = import.meta.env.VITE_PINATA_JWT
      const pin: PinResult = jwt ? await pinAgreement(agreement, jwt) : offlinePin(agreement)
      setPinnedCid(pin.cid)
      const salt = agreement.termsHash

      const additionalCaveats = expiryTs
        ? [{ type: 'timestamp' as const, afterThreshold: now, beforeThreshold: expiryTs }]
        : undefined

      const sdkDelegation = createDelegation({
        to: delegate,
        from: moduleAddress,
        environment: environment as never,
        scope: {
          type: 'erc20PeriodTransfer',
          tokenAddress: tokenAddress as Address,
          periodAmount: parseUnits(amount, tokenDecimals),
          periodDuration: Number(periodToSeconds(period)),
          startDate: now,
        } as never,
        caveats: additionalCaveats as never,
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
          label: payeeName || `${amount} ${tokenSymbol} ${periodLabel(period)}`,
          scopeType: 'erc20SpendingLimit',
          createdAt: new Date().toISOString(),
          chainId: safe.chainId,
          safeAddress: safe.safeAddress as Address,
          moduleAddress,
          status: 'signed',
          delegationHash,
          agreement: { cid: pin.cid, uri: pin.uri, termsHash: agreement.termsHash },
          amount,
          period,
          tokenAddress: tokenAddress as Address,
          expiryDate: expiryEnabled ? expiryDate : undefined,
          recipient: recipient as Address,
        },
      }
      saveDelegation(stored)
      setSigned(stored)

      // Record the signed delegation on the Intuition graph (fire-and-forget via
      // the publisher backend — failures never block the create flow).
      publishToIntuition({
        delegation: stored.delegation,
        chainId: safe.chainId,
        details: { kind: 'subscription', amount, tokenSymbol, period: periodNoun(period) },
        organization: orgSelectionToInput(org),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign subscription')
    } finally {
      setSigning(false)
      setStep('idle')
    }
  }

  function reset() {
    setSigned(null)
    setPayeeName('')
    setOrg(null)
    setRecipient('')
    setAmount('')
    setPeriod('monthly')
    setExpiryEnabled(false)
    setExpiryDate('')
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
              <h2 className="text-lg font-bold text-ink">Subscription signed</h2>
              <p className="text-sm text-dim">Bound on-chain to the IPFS contract. The biller can now charge it every period.</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-raised ring-1 ring-line divide-y divide-line">
            <Row label="Payee"><Payee logo={((signed.meta.recipient ?? signed.delegation.delegate).slice(2, 4)).toUpperCase()} tint="#3B82F6" name={signed.meta.label} addr={short(signed.meta.recipient ?? signed.delegation.delegate)} size={32} /></Row>
            <Row label="Charge"><span className="font-mono font-semibold text-ink">{signed.meta.amount} {signed.meta.tokenAddress ? 'USDC' : ''} / {signed.meta.period}</span></Row>
            <Row label="Contract hash"><Mono className="text-xs text-dim">{short(signed.meta.agreement!.termsHash)}</Mono></Row>
            <Row label="Delegation hash"><Mono className="text-xs text-dim">{short(signed.meta.delegationHash)}</Mono></Row>
            <Row label="Intuition">
              <Mono className="text-xs text-dim">
                {!intuitionEnabled && 'publishing not configured'}
                {intuitionEnabled && intuitionStatus.state === 'publishing' && 'recording on graph…'}
                {intuitionEnabled && intuitionStatus.state === 'done' && 'recorded on graph'}
                {intuitionEnabled && intuitionStatus.state === 'error' && `not recorded — ${intuitionStatus.message}`}
                {intuitionEnabled && intuitionStatus.state === 'idle' && '—'}
              </Mono>
            </Row>
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
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">New subscription</h1>
        <p className="text-dim text-sm mt-1">Sign once. The biller charges it every period, capped on-chain.</p>

        {error && (
          <div className="mt-4 rounded-xl px-3 py-2 text-sm text-danger" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}>
            {error}
          </div>
        )}

        <Card className="p-5 mt-5 space-y-5">
          <Field label="Payee name" hint="Shown in your subscriptions list. Optional.">
            <input type="text" placeholder="Acme Inc." value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
          </Field>
          <Field label="Organization" hint="The org that owns this Safe — reuse one from Intuition or create it. Recorded as “org owns Safe”. Optional.">
            <OrgPicker safeAddress={safe.safeAddress as Address} safeChainId={safe.chainId} value={org} onChange={setOrg} />
          </Field>

          <Field label="Payee address" hint="The account allowed to charge (the delegate) and where funds are paid. Direct redeem — no relayer.">
            <input type="text" placeholder="0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            {recipient && !recipientValid && <p className="text-xs text-danger mt-1">Invalid address</p>}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount per period">
              <div className="relative">
                <input type="number" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value)} min={0} step="any" className="pr-16" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{tokenSymbol}</span>
              </div>
            </Field>
            <Field label="Period">
              <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodType)}>
                {PERIODS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </Field>
          </div>

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

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={expiryEnabled} onChange={(e) => setExpiryEnabled(e.target.checked)} />
              <span className="text-sm text-dim flex items-center gap-1.5"><IconCal size={14} /> Set an end date</span>
            </label>
            {expiryEnabled && <input type="datetime-local" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="mt-2" />}
          </div>
        </Card>
      </div>

      {/* Live contract preview */}
      <Card className="p-5 lg:sticky lg:top-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-faint uppercase tracking-wide"><IconCube size={15} /> Contract preview</div>
          {preview ? <StatusBadge status="pending" size="sm" /> : <span className="text-xs text-faint">Incomplete</span>}
        </div>

        {preview ? (
          <div className="mt-4 space-y-3 text-sm">
            <PreviewRow label="Subscriber"><Mono className="text-xs text-dim">{short(safe.safeAddress)}</Mono></PreviewRow>
            <PreviewRow label="Payee">
              <span className="text-ink truncate">{payeeName || 'Organization'}</span>
              {recipientValid && <Mono className="text-[11px] text-faint block">{short(recipient)}</Mono>}
            </PreviewRow>
            <div className="rounded-xl bg-raised ring-1 ring-line p-3">
              <div className="text-faint text-xs">Charges</div>
              <div className="font-mono font-bold text-ink tnum mt-0.5" style={{ fontSize: 22 }}>
                {amount} <span className="text-dim text-sm font-semibold">{tokenSymbol} / {period}</span>
              </div>
            </div>
            <PreviewRow label={<span className="flex items-center gap-1"><IconLock size={12} /> On-chain cap</span>}>
              <span className="font-mono text-ink">{amount} {tokenSymbol}</span>
              <span className="text-faint text-[11px] block">resets every {period.replace('ly', '')} period</span>
              <span className="text-faint text-[11px] block mt-1">Only token, amount and period are enforced on-chain. The payee address is set at charge time, not enforced by the caveat.</span>
            </PreviewRow>
            {expiryEnabled && expiryDate && (
              <PreviewRow label="Ends"><span className="text-ink text-xs">{new Date(expiryDate).toLocaleString()}</span></PreviewRow>
            )}
            <div className="pt-3 border-t border-line">
              <div className="flex items-center gap-1.5 text-xs text-faint"><IconHash size={12} /> Bound contract hash</div>
              <Mono className="text-[11px] text-dim break-all mt-1 block">{preview.termsHash}</Mono>
              <p className="text-[11px] text-faint mt-2 leading-relaxed">This hash becomes the delegation salt — your signature commits to the exact terms above.</p>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-dim leading-relaxed">Fill in an amount and a valid token to preview the subscription contract that gets pinned to IPFS and bound to your signature.</p>
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
                <p className="text-[11px] text-faint text-center">1 signature · </p>
              </>
            ) : (
              <div className="space-y-3 py-1">
                <StepRow done={step === 'pinning' || step === 'signing'} active={step === 'building'} label="Building human-readable contract" />
                <StepRow
                  done={step === 'signing'}
                  active={step === 'pinning'}
                  label="Pinning to IPFS"
                  sub={step === 'pinning' ? 'pinning…' : pinnedCid ? `CID ${short(pinnedCid)}` : undefined}
                />
                <StepRow active={step === 'signing'} label="Safe signature" sub={step === 'signing' ? 'waiting for signers…' : undefined} />
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
