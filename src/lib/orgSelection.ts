import type { Hex } from 'viem'
import type { OrganizationInput } from './intuition'

/** The organization picker's value (see ui/OrgPicker). */
export type OrgSelection =
  | { atomId: Hex; name: string } // reuse an existing atom
  | { atomId: null; name: string } // create a new atom from this name
  | null // none

export function orgSelectionToInput(sel: OrgSelection): OrganizationInput | undefined {
  if (!sel) return undefined
  return sel.atomId ? { atomId: sel.atomId } : { name: sel.name }
}
