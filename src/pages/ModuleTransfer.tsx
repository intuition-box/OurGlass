import { useState, useEffect, useCallback } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import {
  type Address,
  type Hex,
  encodeFunctionData,
  formatEther,
  formatUnits,
  createPublicClient,
  http,
  parseAbi,
  encodePacked,
  pad,
} from 'viem'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { DEFAULT_SALT } from '../lib/module'
import { Card, Btn, Mono, CopyChip } from '../ui/components'
import { IconWallet, IconCheck, IconAlert, IconRepeat } from '../ui/icons'
import { findChain, rpcUrl } from '../config/supported-chains'

const KNOWN_TOKENS: { address: Address; symbol: string; decimals: number }[] = [
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 }, // Ethereum
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }, // Base
  { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', symbol: 'USDC', decimals: 6 }, // Base Sepolia
  { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', decimals: 6 }, // Ethereum Sepolia
  { address: '0xc78fAbC2cB5B9cf59E0Af3Da8E3Bc46d47753A4e', symbol: 'OSO', decimals: 18 },
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
]

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
])

const SINGLE_DEFAULT_MODE: Hex = pad('0x00', { size: 32 })
const MODULE_EXECUTE_ABI = parseAbi(['function execute(bytes32 mode, bytes calldata executionCalldata) payable'])

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

interface TokenBalance {
  symbol: string
  address: Address | 'native'
  decimals: number
  balance: bigint
  formatted: string
}

export default function ModuleTransfer() {
  const { sdk, safe } = useSafeAppsSDK()
  const [moduleAddress, setModuleAddress] = useState<Address | null>(null)
  const [loading, setLoading] = useState(true)
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set())
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')

  const chainId = safe.chainId
  const chain = findChain(chainId)

  const getClient = useCallback(() => (chain ? createPublicClient({ chain, transport: http(rpcUrl(chainId)) }) : null), [chain, chainId])

  useEffect(() => {
    async function predictModule() {
      const client = getClient()
      if (!client) return
      try {
        const addrs = getAddresses(chainId)
        const predicted = (await client.readContract({
          address: addrs.delegatorModuleFactory,
          abi: DeleGatorModuleFactoryABI,
          functionName: 'predictAddress',
          args: [safe.safeAddress as Address, DEFAULT_SALT],
        })) as Address
        setModuleAddress(predicted)
      } catch (err) {
        console.error('Failed to predict module address:', err)
        setError('Failed to predict module address')
      } finally {
        setLoading(false)
      }
    }
    predictModule()
  }, [chainId, safe.safeAddress, getClient])

  const fetchBalances = useCallback(async () => {
    const client = getClient()
    if (!client || !moduleAddress) return
    setRefreshing(true)
    try {
      const results: TokenBalance[] = []
      const ethBalance = await client.getBalance({ address: moduleAddress })
      if (ethBalance > 0n) {
        results.push({ symbol: 'ETH', address: 'native', decimals: 18, balance: ethBalance, formatted: formatEther(ethBalance) })
      }
      for (const token of KNOWN_TOKENS) {
        try {
          const balance = await client.readContract({ address: token.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [moduleAddress] })
          if (balance > 0n) {
            results.push({ symbol: token.symbol, address: token.address, decimals: token.decimals, balance, formatted: formatUnits(balance, token.decimals) })
          }
        } catch {
          // token may not exist on this chain
        }
      }
      setBalances(results)
      setSelectedAssets(new Set(results.map((b) => b.address)))
    } catch (err) {
      console.error('Failed to fetch balances:', err)
      setError('Failed to fetch module balances')
    } finally {
      setRefreshing(false)
    }
  }, [getClient, moduleAddress])

  useEffect(() => {
    if (moduleAddress) fetchBalances()
  }, [moduleAddress, fetchBalances])

  function toggleAsset(address: string) {
    setSelectedAssets((prev) => {
      const next = new Set(prev)
      if (next.has(address)) next.delete(address)
      else next.add(address)
      return next
    })
  }

  async function handleTransfer() {
    if (!moduleAddress || selectedAssets.size === 0) return
    setSending(true)
    setError('')
    setTxHash('')
    try {
      const safeAddr = safe.safeAddress as Address
      const txs: { to: string; value: string; data: string }[] = []
      for (const asset of balances) {
        if (!selectedAssets.has(asset.address)) continue
        let executionCalldata: Hex
        if (asset.address === 'native') {
          executionCalldata = encodePacked(['address', 'uint256', 'bytes'], [safeAddr, asset.balance, '0x'])
        } else {
          const transferData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [safeAddr, asset.balance] })
          executionCalldata = encodePacked(['address', 'uint256', 'bytes'], [asset.address, 0n, transferData])
        }
        const executeData = encodeFunctionData({ abi: MODULE_EXECUTE_ABI, functionName: 'execute', args: [SINGLE_DEFAULT_MODE, executionCalldata] })
        txs.push({ to: moduleAddress, value: '0', data: executeData })
      }
      const result = await sdk.txs.send({ txs })
      setTxHash(result.safeTxHash)
    } catch (err) {
      console.error('Transfer failed:', err)
      setError(err instanceof Error ? err.message : 'Transfer failed')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="rise flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-line border-t-[color:var(--accent)] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="rise max-w-xl">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Withdraw</h1>
      <p className="text-dim text-sm mt-1">Move assets held by your Delegator module back into the Safe.</p>

      <Card className="p-4 mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint mb-1">Delegator module</p>
            {moduleAddress ? <CopyChip value={moduleAddress} label={short(moduleAddress)} /> : <span className="text-sm text-dim">Not deployed</span>}
          </div>
          <button onClick={fetchBalances} disabled={refreshing || !moduleAddress} className="inline-flex items-center gap-1.5 text-sm text-dim hover:text-ink disabled:opacity-50 transition">
            <IconRepeat size={15} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Loading' : 'Refresh'}
          </button>
        </div>
      </Card>

      {balances.length === 0 ? (
        <Card className="p-10 text-center mt-4">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-raised ring-1 ring-line mx-auto text-faint"><IconWallet size={22} /></div>
          <p className="text-sm text-dim mt-3">{refreshing ? 'Fetching balances…' : 'No assets in the module.'}</p>
        </Card>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink">Module assets</h3>
            <button
              onClick={() => setSelectedAssets(selectedAssets.size === balances.length ? new Set() : new Set(balances.map((b) => b.address)))}
              className="text-xs text-dim hover:text-ink transition"
            >
              {selectedAssets.size === balances.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-2">
            {balances.map((asset) => {
              const on = selectedAssets.has(asset.address)
              return (
                <button
                  key={asset.address}
                  onClick={() => toggleAsset(asset.address)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl transition ${on ? 'bg-raised ring-1 ring-line2' : 'bg-panel ring-1 ring-line hover:ring-line2'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid place-items-center w-9 h-9 rounded-xl font-bold text-xs shrink-0" style={{ color: 'var(--accent)', background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}>
                      {asset.symbol.slice(0, 3)}
                    </span>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-ink">{asset.symbol}</p>
                      {asset.address !== 'native' && <Mono className="text-xs text-faint">{short(asset.address as string)}</Mono>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-ink tnum text-sm">{Number(asset.formatted).toFixed(6)}</span>
                    <span className={`grid place-items-center w-5 h-5 rounded-md ${on ? 'text-[color:var(--accent)]' : 'text-faint'}`} style={on ? { boxShadow: 'inset 0 0 0 1px var(--accent-line)' } : { boxShadow: 'inset 0 0 0 1px var(--color-line)' }}>
                      {on && <IconCheck size={13} />}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl px-3 py-2 text-sm text-danger flex items-center gap-2" style={{ background: 'rgba(251,113,133,.10)', boxShadow: 'inset 0 0 0 1px rgba(251,113,133,.30)' }}>
          <IconAlert size={15} /> {error}
        </div>
      )}
      {txHash && (
        <div className="mt-4 rounded-xl px-3 py-2 text-sm flex items-center gap-2" style={{ background: 'rgba(52,211,153,.08)', boxShadow: 'inset 0 0 0 1px rgba(52,211,153,.22)', color: '#34D399' }}>
          <IconCheck size={15} /> Transaction submitted · <Mono className="text-xs">{short(txHash)}</Mono>
        </div>
      )}

      <div className="mt-5">
        <Btn kind="primary" onClick={handleTransfer} disabled={sending || selectedAssets.size === 0} className="w-full">
          {sending ? 'Submitting…' : selectedAssets.size === 0 ? 'Select assets to withdraw' : `Withdraw ${selectedAssets.size} asset${selectedAssets.size > 1 ? 's' : ''} to Safe`}
        </Btn>
        {selectedAssets.size > 0 && <p className="text-xs text-faint text-center mt-2">Calls execute() on the module per asset. All Safe signers approve.</p>}
      </div>
    </div>
  )
}
