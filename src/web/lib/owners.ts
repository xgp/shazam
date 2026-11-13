/**
 * The owner chips' selection, kept as one set of strings so localStorage and
 * saved views store it unchanged: `owner` includes it, `-owner` excludes it
 * (the same negation the filter box uses). GitHub logins cannot start with a
 * hyphen, so the prefix never collides with a real owner.
 */

export type OwnerChipState = 'off' | 'include' | 'exclude'

export function ownerChipState(selection: Set<string>, owner: string): OwnerChipState {
  if (selection.has(owner)) return 'include'
  if (selection.has(`-${owner}`)) return 'exclude'
  return 'off'
}

/** Cycles a chip off → include → exclude → off. */
export function cycleOwner(selection: Set<string>, owner: string): Set<string> {
  const next = new Set(selection)
  const state = ownerChipState(selection, owner)
  next.delete(owner)
  next.delete(`-${owner}`)
  if (state === 'off') next.add(owner)
  else if (state === 'include') next.add(`-${owner}`)
  return next
}

/**
 * Whether a row from `owner` survives the chips: any included owners act as an
 * allow-list, and excluded owners are dropped on top of that.
 */
export function ownerPasses(selection: Set<string>, owner: string): boolean {
  if (selection.size === 0) return true
  if (selection.has(`-${owner}`)) return false
  const hasIncludes = [...selection].some((entry) => !entry.startsWith('-'))
  return !hasIncludes || selection.has(owner)
}
