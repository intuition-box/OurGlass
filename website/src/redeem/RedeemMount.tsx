'use client'

import dynamic from 'next/dynamic'

// The redeem console is wallet-only (wagmi, viem, injected provider): load it on
// the client and skip prerender so no browser API runs during static export.
const RedeemApp = dynamic(() => import('./RedeemApp').then((m) => m.RedeemApp), {
  ssr: false,
  loading: () => <div className="min-h-screen" />,
})

export function RedeemMount() {
  return <RedeemApp />
}
