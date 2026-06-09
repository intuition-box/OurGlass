import { useState, useEffect } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { encodeFunctionData, encodePacked, pad, parseAbi, type Hex } from 'viem'
import { getDelegations, updateDelegationStatus, removeDelegation, type StoredDelegation } from '../lib/storage'
import { DelegationManagerABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { ipfsToHttp } from '../lib/subscriptionTerms'
import { Card, Btn, StatusBadge, Payee, Mono, CopyChip, type Status } from '../ui/components'
import { IconCube, IconExt, IconLock, IconStop, IconReceipt, IconX, IconCal } from '../ui/icons'

const chainName = (id: number) => (id === 84532 ? 'Base Sepolia' : id === 11155111 ? 'Ethereum Sepolia' : id === 8453 ? 'Base' : `Chain ${id}`)
const statusOf = (s: StoredDelegation['meta']['status']): Status => (s === 'signed' ? 'active' : s === 'revoked' ? 'revoked' : 'pending')
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
// ERC-7579 single-call execution mode + the module's execute() entrypoint.
// disableDelegation must come from the delegator (the module), so we route the
// call through module.execute() — msg.sender at the DelegationManager is then
// the module, satisfying its delegator == msg.sender check. Sending it straight
// from the Safe reverts (InvalidDelegator → GS013).
const SINGLE_DEFAULT_MODE: Hex = pad('0x00', { size: 32 })
const MODULE_EXECUTE_ABI = parseAbi(['function execute(bytes32 mode, bytes calldata executionCalldata) payable'])

const tintFor = (addr: string) => {
  const palette = ['#3B82F6', '#22D3EE', '#8B5CF6', '#34D399', '#FB7185', '#FBBF24']
  let h = 0
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export default function Delegations() {
  const { sdk, safe } = useSafeAppsSDK()
  const [delegations, setDelegations] = useState<StoredDelegation[]>([])
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    loadDelegations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadDelegations() {
    setDelegations(getDelegations().filter((d) => d.meta.safeAddress.toLowerCase() === safe.safeAddress.toLowerCase()))
  }

  async function handleRevoke(d: StoredDelegation) {
    setRevoking(d.meta.delegationHash)
    try {
      const addrs = getAddresses(safe.chainId)
      const disableData = encodeFunctionData({
        abi: DelegationManagerABI,
        functionName: 'disableDelegation',
        args: [
          {
            delegate: d.delegation.delegate,
            delegator: d.delegation.delegator,
            authority: d.delegation.authority,
            caveats: d.delegation.caveats,
            salt: BigInt(d.delegation.salt),
            signature: d.delegation.signature,
          },
        ],
      })
      const executionCalldata = encodePacked(
        ['address', 'uint256', 'bytes'],
        [addrs.delegationManager, 0n, disableData],
      )
      const executeData = encodeFunctionData({
        abi: MODULE_EXECUTE_ABI,
        functionName: 'execute',
        args: [SINGLE_DEFAULT_MODE, executionCalldata],
      })
      const txs = [{ to: d.meta.moduleAddress, value: '0', data: executeData }]
      await sdk.txs.send({ txs })
      updateDelegationStatus(d.meta.delegationHash, 'revoked')
      loadDelegations()
    } catch (err) {
      console.error('Revoke failed:', err)
    } finally {
      setRevoking(null)
    }
  }

  if (delegations.length === 0) {
    return (
      <div className="rise">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink mb-6">Subscriptions</h1>
        <Card className="p-10 text-center">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-raised ring-1 ring-line mx-auto text-faint"><IconReceipt size={22} /></div>
          <h2 className="text-base font-semibold text-ink mt-4">No subscriptions yet</h2>
          <p className="text-sm text-dim mt-1 max-w-sm mx-auto">Signed subscriptions for this Safe appear here, with their on-chain cap and IPFS contract.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="rise">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Subscriptions</h1>
          <p className="text-dim text-sm mt-1">{delegations.length} on {chainName(safe.chainId)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {delegations.map((d) => {
          const status = statusOf(d.meta.status)
          const payeeAddr = d.meta.recipient ?? d.delegation.delegate
          const httpUri = d.meta.agreement && !d.meta.agreement.uri.startsWith('ipfs://local-') ? ipfsToHttp(d.meta.agreement.uri) : undefined
          const isBusy = revoking === d.meta.delegationHash
          return (
            <Card key={d.meta.delegationHash} className={`p-5 relative ${status === 'revoked' ? 'opacity-70' : ''}`}>
              <span className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full" style={{ background: status === 'active' ? '#34D399' : status === 'pending' ? '#FBBF24' : '#FB7185' }} />
              <div className="flex items-start justify-between gap-4">
                <Payee logo={payeeAddr.slice(2, 4).toUpperCase()} tint={tintFor(payeeAddr)} name={d.meta.label} addr={short(payeeAddr)} />
                <div className="flex items-center gap-3 shrink-0">
                  {d.meta.amount && (
                    <div className="text-right">
                      <div className="font-mono font-bold text-ink tnum leading-none">{d.meta.amount} <span className="text-dim text-xs font-semibold">{d.meta.tokenAddress ? 'USDC' : 'ETH'}</span></div>
                      <div className="text-[11px] text-faint mt-1">/ {d.meta.period ?? 'period'}</div>
                    </div>
                  )}
                  <StatusBadge status={status} size="sm" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-dim">
                <span className="inline-flex items-center gap-1.5"><IconLock size={12} className="text-faint" /> Cap {d.meta.amount ?? '—'} {d.meta.tokenAddress ? 'USDC' : ''} / {d.meta.period ?? 'period'}</span>
                {d.meta.expiryDate && <span className="inline-flex items-center gap-1.5"><IconCal size={12} className="text-faint" /> Ends {new Date(d.meta.expiryDate).toLocaleDateString()}</span>}
                <span className="text-faint">Created {new Date(d.meta.createdAt).toLocaleDateString()}</span>
                {d.meta.agreement && (
                  httpUri ? (
                    <a href={httpUri} target="_blank" rel="noreferrer" title={d.meta.agreement.termsHash} className="inline-flex items-center gap-1.5 font-mono text-[color:var(--accent)] hover:underline">
                      <IconCube size={12} /> {d.meta.agreement.cid.slice(0, 14)}… <IconExt size={10} className="opacity-60" />
                    </a>
                  ) : (
                    <span title={d.meta.agreement.termsHash} className="inline-flex items-center gap-1.5 font-mono text-faint"><IconCube size={12} /> offline contract</span>
                  )
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-line flex items-center gap-2">
                <Mono className="text-[11px] text-faint mr-auto">{short(d.meta.delegationHash)}</Mono>
                <CopyChip value={JSON.stringify(d, null, 2)} label="Copy JSON" />
                {d.meta.status === 'signed' && (
                  <Btn kind="danger" size="sm" icon={<IconStop size={14} />} onClick={() => handleRevoke(d)} disabled={isBusy}>
                    {isBusy ? 'Revoking…' : 'Revoke'}
                  </Btn>
                )}
                <button
                  onClick={() => {
                    removeDelegation(d.meta.delegationHash)
                    loadDelegations()
                  }}
                  aria-label="Remove from local storage"
                  title="Remove from local storage"
                  className="grid place-items-center w-9 h-9 rounded-xl text-faint hover:text-ink hover:bg-raised transition"
                >
                  <IconX size={15} />
                </button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
