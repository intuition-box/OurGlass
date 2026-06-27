import { http, createConfig } from 'wagmi'
import { mainnet, baseSepolia, base, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { anvilLocal, rpcUrl } from './config/supported-chains'

// The standalone redeem console lives on the public website (not the Safe iframe),
// so the biller connects MetaMask via the injected connector — no safe() connector.
export const wagmiConfig = createConfig({
  chains: [mainnet, baseSepolia, sepolia, base, anvilLocal],
  // The config mounts at the home layout (so the navbar connect button works), which
  // is prerendered under static export — ssr:true keeps that render storage-safe.
  ssr: true,
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(rpcUrl(mainnet.id)),
    [baseSepolia.id]: http(rpcUrl(baseSepolia.id)),
    [sepolia.id]: http(rpcUrl(sepolia.id)),
    [base.id]: http(rpcUrl(base.id)),
    [anvilLocal.id]: http('http://127.0.0.1:8545'),
  },
})
