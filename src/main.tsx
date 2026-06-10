import React from 'react'
import ReactDOM from 'react-dom/client'
import SafeProvider from '@safe-global/safe-apps-react-sdk'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './config/chains'
import App from './App'
import StandaloneRedeem from './pages/StandaloneRedeem'
import Landing from './pages/Landing'
import Verify from './pages/Verify'
import { Logo } from './ui/components'
import './index.css'

const queryClient = new QueryClient()

// Workshop slide deck, lazy-loaded so it stays out of the app bundle.
const Pitch = React.lazy(() => import('./pages/Pitch'))

// The biller charge console lives on /redeem; everything else is the Safe App.
const isStandalone = window.location.pathname === '/redeem'
const isPitch = window.location.pathname === '/pitch'
const isVerify = window.location.pathname === '/verify'
// The Safe App only works inside the Safe iframe — top-level visitors get a landing.
const inSafeIframe = window.self !== window.top

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPitch ? (
      <React.Suspense fallback={<div className="min-h-screen bg-base" />}>
        <Pitch />
      </React.Suspense>
    ) : isVerify ? (
      <Verify />
    ) : isStandalone ? (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <StandaloneRedeem />
        </QueryClientProvider>
      </WagmiProvider>
    ) : !inSafeIframe ? (
      <Landing />
    ) : (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <SafeProvider
            loader={
              <div className="flex items-center justify-center min-h-screen bg-base">
                <div className="flex flex-col items-center gap-4">
                  <Logo size={34} />
                  <div className="flex items-center gap-2 text-sm text-dim">
                    <span className="w-4 h-4 border-2 border-line border-t-[color:var(--accent)] rounded-full animate-spin" />
                    Connecting to Safe…
                  </div>
                </div>
              </div>
            }
          >
            <App />
          </SafeProvider>
        </QueryClientProvider>
      </WagmiProvider>
    )}
  </React.StrictMode>,
)
