'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const BTN =
  'inline-flex items-center gap-1.5 h-8 rounded-full border border-fd-border px-3 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-line)] disabled:opacity-40';

/** Wallet connect/disconnect control for the Fumadocs navbar. */
export function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const injected = connectors.find((c) => c.id === 'injected') ?? connectors.find((c) => c.type === 'injected');

  // Stable placeholder until hydrated, so the connected state never mismatches SSR.
  if (!mounted) {
    return (
      <button className={BTN} disabled>
        Connect wallet
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} title="Disconnect" className={`${BTN} font-mono`}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#34D399' }} />
        {short(address)}
      </button>
    );
  }

  return (
    <button onClick={() => injected && connect({ connector: injected })} disabled={!injected} className={BTN}>
      Connect wallet
    </button>
  );
}
