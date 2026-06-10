import { useState, type ComponentType } from 'react'
import Home from './pages/Home'
import CreateDelegation from './pages/CreateDelegation'
import ImportDelegation from './pages/ImportDelegation'
import Charge from './pages/Charge'
import ModuleTransfer from './pages/ModuleTransfer'
import { Logo } from './ui/components'
import { IconGrid, IconPlus, IconBolt, IconWallet, IconLink } from './ui/icons'

type Page = 'home' | 'create' | 'import' | 'redeem' | 'withdraw'

const NAV: { key: Page; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { key: 'home', label: 'Overview', icon: IconGrid },
  { key: 'create', label: 'Subscribe', icon: IconPlus },
  { key: 'redeem', label: 'Charge', icon: IconBolt },
  { key: 'withdraw', label: 'Withdraw', icon: IconWallet },
  { key: 'import', label: 'Import', icon: IconLink },
]

function AppInner() {
  const [page, setPage] = useState<Page>('home')

  return (
    <div className="min-h-screen">
      <div className="max-w-[1180px] mx-auto px-5 py-6 grid grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="flex flex-col gap-5 glass-strong rounded-2xl ring-1 ring-line p-4">
          <Logo />
          <nav className="flex flex-col gap-1">
            {NAV.map(({ key, label, icon: Icon }) => {
              const active = page === key
              return (
                <button
                  key={key}
                  onClick={() => setPage(key)}
                  className={`group flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium transition-colors ${
                    active ? 'glass-soft text-ink ring-1 ring-line2' : 'text-dim hover:text-ink hover:bg-raised'
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

          <div className="mt-auto rounded-2xl p-4 ring-1 ring-line glass-soft" style={{ background: 'linear-gradient(160deg,rgba(88,230,184,.12),rgba(28,28,31,.5))' }}>
            <div className="flex items-center gap-2 text-xs font-semibold text-ink">
              <IconBolt size={14} style={{ color: 'var(--accent)' }} /> Sign once.
            </div>
            <p className="text-[11px] text-dim leading-relaxed mt-1.5">Charged every period. Capped on-chain. Revocable.</p>
          </div>
        </aside>

        {/* Content */}
        <main className="app-scroll overflow-y-auto rise" style={{ maxHeight: 'calc(100vh - 48px)' }}>
          {page === 'home' && <Home onNavigate={setPage} />}
          {page === 'create' && <CreateDelegation />}
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
