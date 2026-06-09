import { Logo } from '../ui/components'
import { IconBolt, IconArrowR } from '../ui/icons'

/**
 * Shown when the app is opened top-level (not inside a Safe iframe). The Safe
 * App itself needs the iframe to connect; here we offer the biller's standalone
 * charge console instead of spinning on "Connecting to Safe…" forever.
 */
export default function Landing() {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-6">
      <div className="flex flex-col items-center text-center max-w-md">
        <Logo size={40} />
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">Sign once. Charged every period.</h1>
        <p className="mt-2 text-sm text-dim leading-relaxed">
          OurGlass is a Safe App. Open it inside your Safe to create and manage gasless subscriptions.
        </p>
        <a
          href="/redeem"
          className="group mt-7 inline-flex items-center gap-2 rounded-xl px-4 h-11 text-sm font-semibold transition"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}
        >
          <IconBolt size={16} /> Charge a subscription
          <IconArrowR size={15} className="opacity-70 group-hover:translate-x-0.5 transition-transform" />
        </a>
        <p className="mt-3 text-xs text-faint">Biller console — bill a signed subscription via the 1Shot relayer.</p>
      </div>
    </div>
  )
}
