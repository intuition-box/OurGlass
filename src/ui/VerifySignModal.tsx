// Pre-sign explainer: Safe shows the raw EIP-712 payload; this modal walks the
// signer through independently decoding it on the OurGlass verifier first.
import { useEffect } from 'react'
import { Btn, GaslessButton } from './components'
import { IconCopy, IconCheck, IconDoc, IconExt } from './icons'

const VERIFIER_URL = 'https://verifier.ourglass.intuition.box'

export function VerifySignModal({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="verify-sign-title">
      <button className="absolute inset-0 bg-black/65" onClick={onCancel} aria-label="Close" tabIndex={-1} />
      <div className="relative w-full max-w-lg rounded-2xl glass-strong ring-1 ring-line p-6">
        <h2 id="verify-sign-title" className="text-lg font-bold text-ink">Verify what you sign</h2>
        <p className="mt-1.5 text-sm text-dim leading-relaxed">
          Safe will open a <span className="text-ink font-medium">Confirm message</span> screen with the raw delegation payload.
          Check it independently before approving:
        </p>

        {/* animated copy → paste → verified loop */}
        <div className="relative mt-4 h-[150px] rounded-xl bg-base ring-1 ring-line overflow-hidden" aria-hidden="true">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-[42%] rounded-lg bg-panel ring-1 ring-line p-3">
            <div className="text-[10px] font-semibold text-dim">Safe · Confirm message</div>
            <div className="mt-2 space-y-1.5">
              <div className="h-1.5 rounded bg-line w-full" />
              <div className="h-1.5 rounded bg-line w-4/5" />
              <div className="h-1.5 rounded bg-line w-3/5" />
            </div>
            <div className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] text-ink">
              <span className="og-copy-ping grid place-items-center w-5 h-5 rounded-md ring-1 ring-line2" style={{ color: 'var(--accent)' }}>
                <IconCopy size={11} />
              </span>
              Message
            </div>
          </div>

          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-[42%] rounded-lg bg-panel ring-1 ring-line p-3">
            <div className="text-[10px] font-semibold text-dim truncate">verifier.ourglass…</div>
            <div className="mt-2 h-7 rounded-md bg-raised ring-1 ring-line2 flex items-center justify-between px-2">
              <span className="text-[10px] text-faint">Paste message…</span>
              <span className="og-check-pop" style={{ color: '#34D399' }}><IconCheck size={12} /></span>
            </div>
            <div className="mt-2 h-1.5 rounded bg-line w-2/3" />
          </div>

          <span
            className="og-doc-fly absolute grid place-items-center w-6 h-6 rounded-md"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}
          >
            <IconDoc size={13} />
          </span>
        </div>

        <ol className="mt-4 space-y-2 text-sm text-dim leading-relaxed list-none">
          <li className="flex gap-2.5"><StepNum n={1} />Copy the message — the copy icon next to <span className="text-ink font-medium">Message:</span> on Safe's confirm screen.</li>
          <li className="flex gap-2.5">
            <StepNum n={2} />
            <span>
              Open{' '}
              <a href={VERIFIER_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium" style={{ color: 'var(--accent)' }}>
                verifier.ourglass.intuition.box <IconExt size={12} className="opacity-70" />
              </a>{' '}
              and paste it.
            </span>
          </li>
          <li className="flex gap-2.5"><StepNum n={3} />The verifier decodes the delegation — confirm payee, amount, period and cap match, then approve in Safe.</li>
        </ol>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
          <GaslessButton size="md" onClick={onConfirm}>Continue to sign</GaslessButton>
        </div>
      </div>
    </div>
  )
}

function StepNum({ n }: { n: number }) {
  return (
    <span className="grid place-items-center w-5 h-5 mt-0.5 rounded-full text-[11px] font-bold shrink-0" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
      {n}
    </span>
  )
}
