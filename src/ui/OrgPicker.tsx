import { useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { searchOrganizations, findOwningOrganization, type OrgAtom } from '../lib/intuition'
import type { OrgSelection } from '../lib/orgSelection'

/**
 * Organization picker: type a name to reuse an existing Intuition Organization
 * atom (e.g. "Base") or create a new one. Prefills from an existing
 * `(org) owns (this Safe)` triple. Optional — leave empty to skip the owns edge.
 */

const shortHex = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function OrgPicker({
  safeAddress,
  safeChainId,
  value,
  onChange,
}: {
  safeAddress: Address
  safeChainId: number
  value: OrgSelection
  onChange: (v: OrgSelection) => void
}) {
  const [text, setText] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<OrgAtom[]>([])
  const [loading, setLoading] = useState(false)
  const prefilled = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Prefill from an existing (org owns this Safe) triple, once.
  useEffect(() => {
    if (prefilled.current) return
    prefilled.current = true
    findOwningOrganization(safeAddress, safeChainId)
      .then((org) => {
        if (org && !value) {
          setText(org.name)
          onChange({ atomId: org.atomId, name: org.name })
        }
      })
      .catch(() => undefined)
  }, [safeAddress, safeChainId, value, onChange])

  // Debounced search as the user types. All state updates happen inside the
  // debounce callback (not synchronously in the effect body).
  useEffect(() => {
    const q = text.trim()
    const t = setTimeout(() => {
      if (q.length < 2) {
        setResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      searchOrganizations(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, q.length < 2 ? 0 : 300)
    return () => clearTimeout(t)
  }, [text])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function onInput(v: string) {
    setText(v)
    setOpen(true)
    onChange(v.trim() ? { atomId: null, name: v.trim() } : null)
  }

  const exactExists = results.some((r) => r.name.toLowerCase() === text.trim().toLowerCase())

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={text}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Your organization — e.g. Base (optional)"
        aria-label="Organization that owns this Safe"
      />
      {value?.atomId && (
        <p className="text-[11px] text-faint mt-1">
          Reusing the existing Intuition organization · <span className="font-mono">{shortHex(value.atomId)}</span>
        </p>
      )}
      {value && value.atomId === null && (
        <p className="text-[11px] text-faint mt-1">Will create a new organization on Intuition</p>
      )}
      {open && text.trim().length >= 2 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl glass-strong ring-1 ring-line overflow-hidden">
          {loading && <div className="px-3 py-2 text-xs text-faint">Searching Intuition…</div>}
          {results.map((r) => (
            <button
              key={r.atomId}
              type="button"
              onClick={() => {
                setText(r.name)
                onChange({ atomId: r.atomId, name: r.name })
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#212B43] transition flex items-center justify-between gap-2"
            >
              <span className="text-ink">{r.name}</span>
              <span className="text-[10px] text-faint uppercase tracking-wide">existing · reuse</span>
            </button>
          ))}
          {!loading && !exactExists && (
            <button
              type="button"
              onClick={() => {
                onChange({ atomId: null, name: text.trim() })
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#212B43] transition flex items-center justify-between gap-2 border-t border-line"
            >
              <span className="text-ink">Create &ldquo;{text.trim()}&rdquo;</span>
              <span className="text-[10px] text-faint uppercase tracking-wide">new atom</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
