// SubscRight design-system primitives. Ported from the design handoff.
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { IconBolt, IconCheck, IconCopy } from './icons'

export type Status = 'active' | 'pending' | 'revoked'

// eslint-disable-next-line react-refresh/only-export-components -- shared design tokens, not a route module
export const STATUS: Record<Status, { label: string; color: string; dot: string; soft: string; line: string }> = {
  active: { label: 'Active', color: '#34D399', dot: '#34D399', soft: 'rgba(52,211,153,.12)', line: 'rgba(52,211,153,.30)' },
  pending: { label: 'Pending', color: '#FBBF24', dot: '#FBBF24', soft: 'rgba(251,191,36,.12)', line: 'rgba(251,191,36,.30)' },
  revoked: { label: 'Revoked', color: '#FB7185', dot: '#FB7185', soft: 'rgba(251,113,133,.12)', line: 'rgba(251,113,133,.28)' },
}

export const Logo = ({ size = 26 }: { size?: number }) => (
  <div className="flex items-center gap-2.5 select-none">
    <div
      className="relative grid place-items-center rounded-lg"
      style={{ width: size + 8, height: size + 8, background: 'linear-gradient(150deg,#1A2236,#0E1320)', boxShadow: 'inset 0 0 0 1px #2E3A55' }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12 3 5 6v5c0 4.4 3 7.4 7 9 4-1.6 7-4.6 7-9V6l-7-3Z" stroke="#3B82F6" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M11 2 7 12h3.2L9.4 19 16 9.6h-3.4L13.6 4 11 2Z" fill="var(--accent)" />
      </svg>
    </div>
    <div className="leading-none">
      <div className="font-extrabold tracking-tight text-ink" style={{ fontSize: size * 0.7 }}>
        Subsc<span style={{ color: 'var(--accent)' }}>Right</span>
      </div>
    </div>
  </div>
)

export const USDC = ({ size = 16 }: { size?: number }) => (
  <span className="inline-flex items-center gap-1.5 align-middle">
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="#2775CA" />
      <path d="M12 6v1.2m0 9.6V18m-2.6-3c0 1.2 1.1 1.7 2.6 1.7s2.6-.5 2.6-1.6c0-1-.7-1.4-2.6-1.7-1.7-.3-2.6-.6-2.6-1.7 0-1 1.1-1.6 2.6-1.6s2.6.5 2.6 1.6" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
    <span className="font-semibold">USDC</span>
  </span>
)

export function StatusBadge({ status, size = 'md', variant = 'soft' }: { status: Status; size?: 'sm' | 'md'; variant?: 'soft' | 'outline' }) {
  const s = STATUS[status] || STATUS.pending
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
  const pulse = status === 'active'
  const dot = <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot, animation: pulse ? 'spark 1.8s infinite' : 'none' }} />
  if (variant === 'outline') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad}`} style={{ color: s.color, boxShadow: `inset 0 0 0 1px ${s.line}` }}>
        {dot}
        {s.label}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad}`} style={{ color: s.color, background: s.soft, boxShadow: `inset 0 0 0 1px ${s.line}` }}>
      {dot}
      {s.label}
    </span>
  )
}

type BtnProps = {
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Btn({ kind = 'secondary', size = 'md', icon, children, className = '', ...p }: BtnProps) {
  const sz = size === 'lg' ? 'h-12 px-5 text-[15px]' : size === 'sm' ? 'h-9 px-3 text-[13px]' : 'h-11 px-4 text-sm'
  const base = `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none ${sz} ${className}`
  const styles: Record<string, string> = {
    primary: 'text-white bg-primary hover:bg-primaryd shadow-[0_8px_24px_-10px_rgba(59,130,246,.8)]',
    secondary: 'text-ink bg-raised hover:bg-[#212B43] ring-1 ring-line2',
    ghost: 'text-dim hover:text-ink hover:bg-raised',
    danger: 'text-danger bg-[rgba(251,113,133,.10)] hover:bg-[rgba(251,113,133,.18)] ring-1 ring-[rgba(251,113,133,.30)]',
  }
  return (
    <button className={`${base} ${styles[kind]}`} {...p}>
      {icon}
      {children}
    </button>
  )
}

/** The gasless signature CTA. */
export function GaslessButton({
  children = 'Charge gasless',
  size = 'lg',
  onClick,
  disabled,
  intensity = 1,
  className = '',
}: {
  children?: ReactNode
  size?: 'md' | 'lg'
  onClick?: () => void
  disabled?: boolean
  intensity?: number
  className?: string
}) {
  const sz = size === 'lg' ? 'h-14 px-7 text-base' : 'h-12 px-5 text-[15px]'
  const loud = intensity >= 1.5
  const subtle = intensity <= 0.5
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative inline-flex items-center justify-center gap-2.5 rounded-2xl font-bold text-base overflow-hidden transition-all duration-150 active:scale-[.985] disabled:opacity-40 disabled:pointer-events-none ${sz} ${className}`}
      style={{
        background: subtle ? 'transparent' : 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 92%, #fff) 0%, var(--accent) 100%)',
        color: subtle ? 'var(--accent)' : '#06121A',
        boxShadow: subtle
          ? 'inset 0 0 0 1.5px var(--accent-line)'
          : `0 0 0 1px var(--accent-line), 0 12px 34px -10px color-mix(in srgb, var(--accent) ${loud ? 75 : 50}%, transparent)`,
        animation: loud ? 'pulse-ring 2.2s infinite' : 'none',
      }}
    >
      {!subtle && (
        <span
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg]"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent)', animation: loud ? 'sweep 2.4s linear infinite' : 'sweep 3.6s linear infinite' }}
        />
      )}
      <IconBolt size={20} />
      <span className="relative whitespace-nowrap">{children}</span>
    </button>
  )
}

export const Card = ({ className = '', hover = false, children, ...p }: { className?: string; hover?: boolean; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`rounded-2xl bg-panel ring-1 ring-line shadow-card ${hover ? 'transition-all duration-200 hover:ring-line2 hover:-translate-y-0.5' : ''} ${className}`} {...p}>
    {children}
  </div>
)

export const Mono = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <span className={`font-mono ${className}`}>{children}</span>
)

export function CopyChip({ value, label, className = '' }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {})
        setDone(true)
        setTimeout(() => setDone(false), 1100)
      }}
      className={`group inline-flex items-center gap-2 rounded-lg bg-raised ring-1 ring-line px-2.5 py-1.5 font-mono text-xs text-dim hover:text-ink hover:ring-line2 transition ${className}`}
    >
      <span className="truncate">{label || value}</span>
      {done ? <IconCheck size={14} style={{ color: '#34D399' }} /> : <IconCopy size={14} className="opacity-50 group-hover:opacity-100" />}
    </button>
  )
}

export function Feature({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}>
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="text-xs text-dim leading-relaxed mt-0.5">{desc}</div>
      </div>
    </div>
  )
}

export const Payee = ({ logo, tint, name, addr, size = 40 }: { logo: string; tint: string; name?: string; addr?: string; size?: number }) => (
  <div className="flex items-center gap-3">
    <div className="grid place-items-center rounded-xl font-bold shrink-0" style={{ width: size, height: size, fontSize: size * 0.34, color: tint, background: `${tint}1f`, boxShadow: `inset 0 0 0 1px ${tint}40` }}>
      {logo}
    </div>
    {name && (
      <div className="leading-tight min-w-0">
        <div className="font-semibold text-ink truncate">{name}</div>
        <div className="font-mono text-xs text-faint truncate">{addr}</div>
      </div>
    )}
  </div>
)
