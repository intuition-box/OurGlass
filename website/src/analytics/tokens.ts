import { createPublicClient, http, erc20Abi, parseAbi, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { ANALYTICS_RPC_URL, KNOWN_TOKENS } from './config';

export interface TokenMeta {
  symbol: string;
  decimals: number;
}

const UINT256_DECIMALS = parseAbi(['function decimals() view returns (uint256)']);
const client = createPublicClient({ chain: mainnet, transport: http(ANALYTICS_RPC_URL) });

async function readMeta(address: Address): Promise<TokenMeta> {
  const known = KNOWN_TOKENS[address.toLowerCase()];
  if (known) return known;
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
    client
      .readContract({ address, abi: erc20Abi, functionName: 'decimals' })
      .catch(async () => Number(await client.readContract({ address, abi: UINT256_DECIMALS, functionName: 'decimals' })))
      .catch(() => 18),
  ]);
  return { symbol: symbol || '?', decimals: Number(decimals) };
}

/** Resolve metadata for a set of tokens, keyed by lowercased address. */
export async function resolveTokens(addresses: Address[]): Promise<Map<string, TokenMeta>> {
  const distinct = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const metas = await Promise.all(distinct.map((a) => readMeta(a as Address)));
  return new Map(distinct.map((a, i) => [a, metas[i]]));
}
