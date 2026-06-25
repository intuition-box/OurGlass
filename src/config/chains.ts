import { http, createConfig } from 'wagmi'
import { mainnet, baseSepolia, base, sepolia } from 'wagmi/chains'
import { safe, injected } from 'wagmi/connectors'
import { anvilLocal, rpcUrl } from './supported-chains'

export const wagmiConfig = createConfig({
  chains: [mainnet, baseSepolia, sepolia, base, anvilLocal],
  // safe() auto-connects inside the Safe App iframe; injected() lets the biller
  // (org EOA) connect MetaMask in the standalone redeem console.
  connectors: [safe(), injected()],
  transports: {
    [mainnet.id]: http(rpcUrl(mainnet.id)),
    [baseSepolia.id]: http(rpcUrl(baseSepolia.id)),
    [sepolia.id]: http(rpcUrl(sepolia.id)),
    [base.id]: http(rpcUrl(base.id)),
    [anvilLocal.id]: http('http://127.0.0.1:8545'),
  },
})
