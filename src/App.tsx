import { useState, type ComponentType } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import Home from './pages/Home'
import CreateDelegation from './pages/CreateDelegation'
import Delegations from './pages/Delegations'
import ImportDelegation from './pages/ImportDelegation'
import Charge from './pages/Charge'
import ModuleTransfer from './pages/ModuleTransfer'
import { Logo } from './ui/components'
import { IconGrid, IconPlus, IconBolt, IconWallet, IconLink } from './ui/icons'

type Page = 'home' | 'create' | 'delegations' | 'import' | 'redeem' | 'withdraw'

const NAV: { key: Page; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { key: 'home', label: 'Overview', icon: IconGrid },
  { key: 'create', label: 'New subscription', icon: IconPlus },
  { key: 'redeem', label: 'Charge', icon: IconBolt },
  { key: 'withdraw', label: 'Withdraw', icon: IconWallet },
  { key: 'import', label: 'Import', icon: IconLink },
]

function AppInner() {
  const { safe } = useSafeAppsSDK()
  const [page, setPage] = useState<Page>('home')
  const short = `${safe.safeAddress.slice(0, 6)}…${safe.safeAddress.slice(-4)}`

  return (
    <div className="min-h-screen">
      {/* Top context bar (Safe provides this in the real iframe) */}
      <div className="sticky top-0 z-20" style={{ background: 'rgba(8,11,18,.6)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1180px] mx-auto h-12 px-5 flex items-center justify-between border-b border-line">
          <div className="text-xs text-faint font-medium">Safe / Apps / <span className="text-dim">SubscRight</span></div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-raised ring-1 ring-line px-2.5 py-1 text-xs text-dim">
              <span className="w-1.5 h-1.5 rounded-full bg-active" /> Chain {safe.chainId}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-raised ring-1 ring-line px-2.5 py-1 text-xs font-mono text-dim">
              {short}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1180px] mx-auto px-5 py-6 grid grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="flex flex-col gap-5">
          <Logo />
          <nav className="flex flex-col gap-1">
            {NAV.map(({ key, label, icon: Icon }) => {
              const active = page === key
              return (
                <button
                  key={key}
                  onClick={() => setPage(key)}
                  className={`group flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium transition-colors ${
                    active ? 'bg-raised text-ink ring-1 ring-line2' : 'text-dim hover:text-ink hover:bg-raised'
                  }`}
                >
                  <span style={{ color: active ? 'var(--accent)' : undefined }}>
                    <Icon size={18} />
                  </span>
                  {label}
                </button>
              )
            })}
          </nav>

          <div className="mt-auto rounded-2xl p-4 ring-1 ring-line bg-panel" style={{ boxShadow: 'var(--shadow-card)' }}>
            <div className="text-sm font-semibold text-ink">Sign once. Charged every period.</div>
            <div className="text-xs text-dim leading-relaxed mt-1">
              <span style={{ color: 'var(--accent)' }}>Gasless</span> · capped on-chain · revocable any time.
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="app-scroll overflow-y-auto rise" style={{ maxHeight: 'calc(100vh - 96px)' }}>
          {page === 'home' && <Home onNavigate={setPage} />}
          {page === 'create' && <CreateDelegation />}
          {page === 'delegations' && <Delegations />}
          {page === 'import' && <ImportDelegation />}
          {page === 'redeem' && <Charge />}
          {page === 'withdraw' && <ModuleTransfer />}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return <AppInner />
}
