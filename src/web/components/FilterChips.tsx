import { Badge } from '@/components/ui/badge'
import { ownerChipState, type OwnerChipState } from '@/lib/owners'
import { cn } from '@/lib/utils'

export interface FilterChipsProps {
  owners: { owner: string; count: number }[]
  /** `owner` = included, `-owner` = excluded; see lib/owners. */
  selected: Set<string>
  onToggle: (owner: string) => void
  onClear: () => void
}

const chipClass = (state: OwnerChipState) =>
  cn(
    'cursor-pointer select-none',
    state === 'off' && 'bg-secondary text-muted-foreground hover:bg-secondary/80',
    state === 'exclude' &&
      'bg-destructive/15 text-destructive line-through decoration-2 hover:bg-destructive/25 dark:bg-destructive/25',
  )

const TITLES: Record<OwnerChipState, string> = {
  off: 'Click to show only this owner',
  include: 'Click to hide this owner',
  exclude: 'Click to clear',
}

/**
 * Owner filter derived from whatever is currently on screen, so it needs no
 * configuration and adapts as the developer's orgs change. Each chip cycles
 * off → include → exclude, so a noisy owner can be hidden without having to
 * pick every other one.
 */
export function FilterChips({ owners, selected, onToggle, onClear }: FilterChipsProps) {
  if (owners.length < 2) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge className={chipClass(selected.size === 0 ? 'include' : 'off')} onClick={onClear}>
        All
      </Badge>
      {owners.map(({ owner, count }) => {
        const state = ownerChipState(selected, owner)
        return (
          <Badge
            key={owner}
            className={chipClass(state)}
            title={TITLES[state]}
            aria-pressed={state === 'off' ? false : state === 'include' ? true : 'mixed'}
            onClick={() => onToggle(owner)}
          >
            {owner}
            <span className={state === 'off' ? 'text-muted-foreground' : 'opacity-75'}>{count}</span>
          </Badge>
        )
      })}
    </div>
  )
}
