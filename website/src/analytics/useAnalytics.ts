import { useCallback, useEffect, useState } from 'react';
import { loadCharges, type Charge } from './events';
import { resolveTokens, type TokenMeta } from './tokens';

export interface AnalyticsState {
  loading: boolean;
  error: string | null;
  charges: Charge[];
  tokens: Map<string, TokenMeta>;
  refresh: () => void;
}

/**
 * Load OurGlass on-chain charges and the metadata for the tokens they touch.
 * Owns the lifecycle; the dashboard component renders the result.
 */
export function useAnalytics(): AnalyticsState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [tokens, setTokens] = useState<Map<string, TokenMeta>>(new Map());
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const loaded = await loadCharges();
      const meta = await resolveTokens(loaded.map((c) => c.token));
      if (!cancelled) {
        setCharges(loaded);
        setTokens(meta);
        setLoading(false);
      }
    })().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Failed to read on-chain analytics');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { loading, error, charges, tokens, refresh };
}
