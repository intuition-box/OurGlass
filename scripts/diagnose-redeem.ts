import { readFileSync } from 'node:fs'
import { createPublicClient, http, BaseError, type Address, type Hex } from 'viem'
import { baseSepolia, base, sepolia } from 'viem/chains'
import { buildRedeemTx } from '../src/lib/redeemDirect'
import type { StoredDelegation } from '../src/lib/storage'

const chains: Record<number, typeof baseSepolia | typeof base | typeof sepolia> = {
  84532: baseSepolia,
  11155111: sepolia,
  8453: base,
}

/**
 * Reproduce the Charge redeem off-chain to surface the real revert behind GS013.
 * Usage: bun scripts/diagnose-redeem.ts <localStorage-dump.json> <chainId>
 * The dump is the raw value of the `gator-delegations` localStorage key.
 */
async function main() {
  const [file, chainIdArg] = process.argv.slice(2)
  if (!file || !chainIdArg) {
    console.error('usage: bun scripts/diagnose-redeem.ts <dump.json> <chainId>')
    process.exit(1)
  }
  const chainId = Number(chainIdArg)
  const chain = chains[chainId]
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`)

  const raw = readFileSync(file, 'utf8')
  const delegations: StoredDelegation[] = JSON.parse(raw)
  const client = createPublicClient({ chain, transport: http() })

  const chargeable = delegations.filter(
    (d) => d.meta.scopeType === 'erc20SpendingLimit' && d.meta.status === 'signed',
  )
  if (chargeable.length === 0) {
    console.log('No signed erc20SpendingLimit delegations in the dump.')
    return
  }

  for (const d of chargeable) {
    const safe = d.delegation.delegate as Address // the Safe charging = the delegate
    const recipient = (d.meta.recipient ?? d.delegation.delegate) as Address
    const amount = d.meta.amount ?? '0'
    const tokenAddress = d.meta.tokenAddress
    console.log('\n────────────────────────────────────────')
    console.log('label      :', d.meta.label)
    console.log('delegate(Safe):', safe)
    console.log('delegator  :', d.delegation.delegator)
    console.log('recipient  :', recipient)
    console.log('amount     :', amount, '| token:', tokenAddress)

    if (!tokenAddress) {
      console.log('→ SKIP: no token address')
      continue
    }

    let decimals = 6
    try {
      decimals = await client.readContract({
        address: tokenAddress,
        abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
        functionName: 'decimals',
      })
    } catch {
      // default to USDC decimals
    }

    // delegator USDC balance — the enforcer transfers FROM the delegator
    try {
      const bal = await client.readContract({
        address: tokenAddress,
        abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'balanceOf',
        args: [d.delegation.delegator as Address],
      })
      console.log('delegator token balance:', bal.toString(), `(${Number(bal) / 10 ** decimals})`)
    } catch (e) {
      console.log('delegator balance read failed:', e instanceof Error ? e.message : String(e))
    }

    const code = await client.getCode({ address: d.delegation.delegator as Address })
    console.log('delegator deployed:', code && code !== '0x' ? 'yes' : 'NO (empty code)')

    const tx = buildRedeemTx({
      chainId,
      delegation: d.delegation,
      token: { address: tokenAddress, decimals },
      amount,
      recipient,
    })

    try {
      await client.call({ account: safe, to: tx.to, data: tx.data as Hex })
      console.log('→ SIMULATION OK — redeem would succeed.')
    } catch (sim) {
      const reason = sim instanceof BaseError ? sim.shortMessage : sim instanceof Error ? sim.message : String(sim)
      console.log('→ REVERT:', reason)
      if (sim instanceof BaseError && sim.details) console.log('  details:', sim.details)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
