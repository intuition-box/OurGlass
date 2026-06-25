import { type Address, type Chain } from 'viem'
import { mainnet, base, baseSepolia, sepolia, foundry } from 'viem/chains'

/**
 * Single source of truth for the chains the app supports. Add a chain HERE (its
 * viem Chain, USDC address, display meta) and every consumer — wagmi config, the
 * per-page clients, the redeem/verify selectors, the chain-name and explorer
 * helpers — picks it up. No more duplicated `{ 84532: baseSepolia, … }` maps.
 *
 * Per-chain contract addresses (DelegationManager, enforcers, module factory)
 * still live in `addresses.ts`, which this complements.
 */

// Anvil local chain (Base Sepolia fork) for end-to-end tests.
export const anvilLocal: Chain = {
  ...foundry,
  id: 31337,
  name: 'Anvil (Local)',
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
}

export const SUPPORTED_CHAINS: readonly Chain[] = [mainnet, base, baseSepolia, sepolia, anvilLocal]

/** The viem Chain for an id, or undefined if unsupported (callers null-check). */
export function findChain(chainId: number): Chain | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId)
}

/** USDC (6 decimals) per chain. */
export const USDC_ADDRESS: Record<number, Address> = {
  [mainnet.id]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  [base.id]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [baseSepolia.id]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  [sepolia.id]: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
}

interface ChainMeta {
  name: string
  explorer: string
  /** Shown in chain selectors (redeem console, verify). Anvil is dev-only and excluded. */
  selectable: boolean
}

const CHAIN_META: Record<number, ChainMeta> = {
  [mainnet.id]: { name: 'Ethereum', explorer: 'https://etherscan.io', selectable: true },
  [base.id]: { name: 'Base', explorer: 'https://basescan.org', selectable: true },
  [baseSepolia.id]: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org', selectable: true },
  [sepolia.id]: { name: 'Ethereum Sepolia', explorer: 'https://sepolia.etherscan.io', selectable: true },
}

export function chainName(chainId: number): string {
  return CHAIN_META[chainId]?.name ?? `Chain ${chainId}`
}

export function explorerTx(chainId: number, hash: string): string {
  const base = CHAIN_META[chainId]?.explorer ?? 'https://etherscan.io'
  return `${base}/tx/${hash}`
}

/** Chains offered in the redeem/verify selectors, in display order. */
export const SELECTABLE_CHAINS: { id: number; label: string; explorer: string }[] = SUPPORTED_CHAINS
  .filter((c) => CHAIN_META[c.id]?.selectable)
  .map((c) => ({ id: c.id, label: CHAIN_META[c.id].name, explorer: CHAIN_META[c.id].explorer }))
