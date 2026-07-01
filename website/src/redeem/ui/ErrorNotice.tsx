'use client';

import { useState } from 'react';
import { IconAlert } from './icons';
import type { UserError } from '../lib/errors';

/**
 * Renders a UserError as a compact card: title + one-line cause + how-to-fix, with
 * the raw error tucked behind a collapsible "Technical details". Warning = amber
 * (recoverable), error = red (failed).
 */
export function ErrorNotice({ error }: { error: UserError }) {
  const [open, setOpen] = useState(false);
  const warn = error.severity === 'warning';
  const color = warn ? '#FBBF24' : '#FB7185';
  const bg = warn ? 'rgba(251,191,36,.08)' : 'rgba(251,113,133,.10)';
  const ring = warn ? 'rgba(251,191,36,.25)' : 'rgba(251,113,133,.30)';

  return (
    <div className="mt-4 rounded-xl px-3 py-3 text-xs leading-relaxed" style={{ background: bg, boxShadow: `inset 0 0 0 1px ${ring}`, color }}>
      <div className="flex items-center gap-1.5 font-semibold">
        <IconAlert size={13} /> {error.title}
      </div>
      {error.detail && <p className="mt-1 opacity-90">{error.detail}</p>}
      {error.fix && <p className="mt-1.5 font-medium">→ {error.fix}</p>}
      {error.technical && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 underline opacity-70 hover:opacity-100">
            {open ? '▾' : '▸'} Technical details
          </button>
          {open && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] opacity-60">{error.technical}</pre>}
        </>
      )}
    </div>
  );
}
