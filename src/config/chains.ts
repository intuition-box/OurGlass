import { http, createConfig } from 'wagmi'
import { type Chain } from 'viem'
import { mainnet, baseSepolia, base, sepolia, foundry } from 'wagmi/chains'
import { safe, injected } from 'wagmi/connectors'

// Anvil local chain (Base Sepolia fork)
export const anvilLocal: Chain = {
  ...foundry,
  id: 31337,
  name: 'Anvil (Local)',
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
}

export const wagmiConfig = createConfig({
  chains: [mainnet, baseSepolia, sepolia, base, anvilLocal],
  // safe() auto-connects inside the Safe App iframe; injected() lets the biller
  // (org EOA) connect MetaMask in the standalone redeem console.
  connectors: [safe(), injected()],
  transports: {
    [mainnet.id]: http(),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
    [base.id]: http(),
    [anvilLocal.id]: http('http://127.0.0.1:8545'),
  },
})
