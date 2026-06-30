'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live-stats chronometer: a watch-dial with a rotating "liseret" and two stacked
 * counters — total value settled through OurGlass (jumps per charge) and the amount
 * streaming live now (ticks up every second). Pure presentational: figures are
 * passed in (computed from the analytics data); `streaming` is extrapolated locally
 * from `streamingBase + streamingRate × elapsed` so it moves between reads.
 */
const usd2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CX = 230;
const CY = 230;
const TRACK_R = 200;

// Round so the SVG coordinate strings are identical on server and client — raw
// Math.cos/sin differ by ~1 ULP across the Node/browser engines, which trips React's
// hydration check.
const r2 = (n: number) => Math.round(n * 100) / 100;

// 60 dial ticks; every 5th is medium, every 15th (the cardinals) long + brighter.
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const angle = (i * 6 - 90) * (Math.PI / 180);
  const cardinal = i % 15 === 0;
  const inner = cardinal ? 192 : i % 5 === 0 ? 197 : 202;
  const outer = 212;
  return {
    x1: r2(CX + Math.cos(angle) * inner),
    y1: r2(CY + Math.sin(angle) * inner),
    x2: r2(CX + Math.cos(angle) * outer),
    y2: r2(CY + Math.sin(angle) * outer),
    cardinal,
  };
});

const CIRC = 2 * Math.PI * TRACK_R;
const COMET = 150;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function LiveStats({
  settled,
  streamingBase,
  streamingRate,
  loaded,
}: {
  settled: number;
  streamingBase: number;
  streamingRate: number;
  loaded: boolean;
}) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(0);
  const baseAtRef = useRef<number | null>(null);

  // Reset the tick origin whenever the base figures change (a fresh analytics read).
  useEffect(() => {
    baseAtRef.current = performance.now();
  }, [streamingBase, streamingRate]);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const tick = (t: number) => {
      setNow(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const elapsed = baseAtRef.current !== null ? Math.max(0, (now - baseAtRef.current) / 1000) : 0;
  const streaming = streamingBase + streamingRate * elapsed;

  return (
    <div className="relative aspect-square w-full max-w-[460px]">
      <svg viewBox="0 0 460 460" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {/* outer hairline ring */}
        <circle cx={CX} cy={CY} r={216} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        {/* dial ticks */}
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.cardinal ? 'var(--accent)' : 'rgba(255,255,255,0.16)'}
            strokeWidth={t.cardinal ? 2 : 1}
            strokeLinecap="round"
            opacity={t.cardinal ? 0.9 : 0.6}
          />
        ))}
        {/* faint base track */}
        <circle cx={CX} cy={CY} r={TRACK_R} fill="none" stroke="rgba(88,230,184,0.08)" strokeWidth={2} />
        {/* rotating comet liseret */}
        <g className="og-chrono-spin">
          <circle
            cx={CX}
            cy={CY}
            r={TRACK_R}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={`${COMET} ${CIRC - COMET}`}
            style={{ filter: 'drop-shadow(0 0 6px var(--accent))' }}
          />
          {/* bright head at the comet's leading edge (path start, 3 o'clock) */}
          <circle cx={CX + TRACK_R} cy={CY} r={3.5} fill="#d6fff1" style={{ filter: 'drop-shadow(0 0 7px var(--accent))' }} />
        </g>
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-12 font-mono">
        <div className="text-center">
          <div className="text-[11px] tracking-[0.3em] text-[color:var(--accent)]">LIVE SETTLEMENT</div>
          <div className="mt-2 text-[clamp(26px,5vw,44px)] font-semibold tabular-nums text-fd-foreground">
            {loaded ? `$${usd2.format(settled)}` : '—'}
          </div>
          <div className="mt-1 text-[10px] tracking-[0.25em] text-[color:var(--color-faint)]">TOTAL SETTLED (USDC)</div>
        </div>

        <div className="my-5 flex w-44 items-center gap-2">
          <span className="h-px flex-1 bg-[rgba(255,255,255,0.10)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" style={{ boxShadow: '0 0 8px var(--accent)' }} />
          <span className="h-px flex-1 bg-[rgba(255,255,255,0.10)]" />
        </div>

        <div className="text-center">
          <div className="text-[11px] tracking-[0.3em] text-[color:var(--accent)]">STREAMING LIVE NOW</div>
          <div
            className="mt-2 text-[clamp(28px,5.5vw,52px)] font-semibold tabular-nums text-[color:var(--accent)]"
            style={{ textShadow: '0 0 18px rgba(88,230,184,0.45)' }}
          >
            {loaded ? `$${streaming.toFixed(6)}` : '—'}
          </div>
          <div className="mt-1 text-[10px] tracking-[0.25em] text-[color:var(--color-faint)]">USDC / s</div>
        </div>
      </div>
    </div>
  );
}
