import { defineChain, type Chain, type Hex } from 'viem'

/**
 * Intuition L3 read config for the redeem console. The website is isolated from
 * the repo-root `src/lib/intuition` service, so the network metadata + the
 * predicate term_ids we query by are duplicated here (read-only subset).
 *
 * Network is chosen at build time via NEXT_PUBLIC_INTUITION_NETWORK: previews use
 * `testnet` (where the publisher writes today), prod uses `mainnet`. Default:
 * testnet.
 */

export type IntuitionNetwork = 'testnet' | 'mainnet'

export interface IntuitionReadConfig {
  network: IntuitionNetwork
  chainId: number
  multiVault: Hex
  graphqlUrl: string
  explorerUrl: string
  chain: Chain
  /** Predicate term_ids to query by (per network — null when not yet on that graph). */
  predicates: { delegateTo: Hex | null; inContextOf: Hex }
}

export const intuitionTestnet: Chain = defineChain({
  id: 13579,
  name: 'Intuition Testnet',
  nativeCurrency: { decimals: 18, name: 'Test Trust', symbol: 'tTRUST' },
  rpcUrls: { default: { http: ['https://testnet.rpc.intuition.systems/http'] } },
  blockExplorers: {
    default: { name: 'Intuition Testnet Explorer', url: 'https://testnet.explorer.intuition.systems' },
  },
})

export const intuitionMainnet: Chain = defineChain({
  id: 1155,
  name: 'Intuition',
  nativeCurrency: { decimals: 18, name: 'Intuition', symbol: 'TRUST' },
  rpcUrls: { default: { http: ['https://rpc.intuition.systems/http'] } },
  blockExplorers: { default: { name: 'Intuition Explorer', url: 'https://explorer.intuition.systems' } },
})

const NETWORKS: Record<IntuitionNetwork, IntuitionReadConfig> = {
  testnet: {
    network: 'testnet',
    chainId: 13579,
    multiVault: '0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91',
    graphqlUrl: 'https://testnet.intuition.sh/v1/graphql',
    explorerUrl: 'https://testnet.explorer.intuition.systems',
    chain: intuitionTestnet,
    predicates: {
      delegateTo: '0xb56980d42a3b03455bf41ea20fe04ae223fca0b9e688994dc661414e81e6433b',
      inContextOf: '0x61a88b9c372c0d164d2caf66947b67ed0fcb4c457178a271b6b3dc39fb1f8862',
    },
  },
  mainnet: {
    network: 'mainnet',
    chainId: 1155,
    multiVault: '0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e',
    graphqlUrl: 'https://mainnet.intuition.sh/v1/graphql',
    explorerUrl: 'https://explorer.intuition.systems',
    chain: intuitionMainnet,
    // term_ids unknown until the predicates are created on mainnet (see ADR 0003).
    predicates: { delegateTo: null, inContextOf: '0x' },
  },
}

export function getIntuitionReadConfig(): IntuitionReadConfig {
  const env = process.env.NEXT_PUBLIC_INTUITION_NETWORK
  const network: IntuitionNetwork = env === 'mainnet' ? 'mainnet' : 'testnet'
  return NETWORKS[network]
}
