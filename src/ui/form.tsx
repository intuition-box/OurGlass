import type { ReactNode } from 'react'
import { Card } from './components'
import { IconCal } from './icons'

/** A titled form section (optional right-aligned action, e.g. a Segmented toggle). */
export function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-faint uppercase tracking-wide"><span className="text-ink"><IconCal size={14} /></span> {title}</div>
        {action}
      </div>
      {children}
    </Card>
  )
}

/** A labelled field; `required` shows a `*` that turns red when `missing`. */
export function Field({ label, hint, required, missing, children }: { label: string; hint?: string; required?: boolean; missing?: boolean; children: ReactNode }) {
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

/** Pill toggle (green active). Keys can be strings or booleans. */
export function Segmented<T extends string | boolean>({ options, value, onChange }: {
  options: { key: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-raised ring-1 ring-line">
      {options.map((o, i) => {
        const active = o.key === value
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(o.key)}
            className={`px-3 h-7 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition ${active ? '' : 'text-dim hover:text-ink'}`}
            style={active ? { background: 'var(--accent)', color: '#08130d', boxShadow: '0 1px 8px rgba(88,230,184,.3)' } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A label/value row inside a bordered list (the signed-summary card). */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-faint">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}

/** A compact label/value row for the live preview column. */
export function PreviewRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-faint mt-0.5">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}
