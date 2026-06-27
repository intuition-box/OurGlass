'use client'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './wagmi'
import { StandaloneRedeem } from './StandaloneRedeem'

const queryClient = new QueryClient()

/** Wallet-connected redeem console, mounted client-side only (see RedeemMount). */
export function RedeemApp() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <StandaloneRedeem />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
