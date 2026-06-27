import { erc20Abi, parseAbi, type Address, type PublicClient } from 'viem'

/**
 * ERC-20 metadata reads. Standard tokens expose `decimals() uint8`, but weird
 * tokens don't: USDT declares `decimals` as `uint256`. This helper falls back to
 * that shape so resolution works for any token.
 */
const UINT256_DECIMALS = parseAbi(['function decimals() view returns (uint256)'])

/** `decimals()`, tolerating tokens that declare it as `uint256` (e.g. USDT). */
export async function readErc20Decimals(client: PublicClient, address: Address): Promise<number> {
  try {
    return await client.readContract({ address, abi: erc20Abi, functionName: 'decimals' })
  } catch {
    return Number(await client.readContract({ address, abi: UINT256_DECIMALS, functionName: 'decimals' }))
  }
}
