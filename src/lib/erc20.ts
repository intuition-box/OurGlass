import { erc20Abi, parseAbi, hexToString, type Address, type Hex, type PublicClient } from 'viem'

/**
 * ERC-20 metadata reads. Standard tokens expose `decimals() uint8` and
 * `name()/symbol() string`, but weird tokens don't: USDT declares `decimals` as
 * `uint256` and some older tokens return `name/symbol` as `bytes32`. These helpers
 * fall back to those shapes so resolution works for any token.
 */

const UINT256_DECIMALS = parseAbi(['function decimals() view returns (uint256)'])
const BYTES32_META = parseAbi(['function name() view returns (bytes32)', 'function symbol() view returns (bytes32)'])

/** `decimals()`, tolerating tokens that declare it as `uint256` (e.g. USDT). */
export async function readErc20Decimals(client: PublicClient, address: Address): Promise<number> {
  try {
    return await client.readContract({ address, abi: erc20Abi, functionName: 'decimals' })
  } catch {
    return Number(await client.readContract({ address, abi: UINT256_DECIMALS, functionName: 'decimals' }))
  }
}

/** `name()`/`symbol()`, best-effort: tolerates `bytes32` returns; '' if unreadable. */
export async function readErc20StringField(client: PublicClient, address: Address, fn: 'name' | 'symbol'): Promise<string> {
  try {
    return await client.readContract({ address, abi: erc20Abi, functionName: fn })
  } catch {
    try {
      const b = await client.readContract({ address, abi: BYTES32_META, functionName: fn })
      return hexToString(b as Hex).split(String.fromCharCode(0))[0].trim()
    } catch {
      return ''
    }
  }
}

export interface Erc20Meta {
  name: string
  symbol: string
  decimals: number
}

/** Resolve a token's metadata. Throws if `decimals` is unreadable (not an ERC-20 on this chain). */
export async function readErc20Meta(client: PublicClient, address: Address): Promise<Erc20Meta> {
  const decimals = await readErc20Decimals(client, address)
  const [symbol, name] = await Promise.all([
    readErc20StringField(client, address, 'symbol'),
    readErc20StringField(client, address, 'name'),
  ])
  return { name, symbol: symbol || '?', decimals }
}
