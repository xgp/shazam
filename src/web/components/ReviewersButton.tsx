import {
  Ban,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  UserCheck,
  UserPen,
  UserPlus,
  UserSearch,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type {
  PullRequestItem,
  Reviewer,
  ReviewerCandidate,
  ReviewerState,
  ReviewersPanel,
} from '../../shared/types.js'
import { api } from '../lib/api.js'
import { BUTTON_SOFT, type ChipColor, CHIP_SOFT } from './chips.js'
import { useToast } from './Toaster.js'

const STATE_LABEL: Record<ReviewerState, string> = {
  pending: 'waiting',
  approved: 'approved',
  changes_requested: 'changes',
  commented: 'commented',
  dismissed: 'dismissed',
}

const STATE_COLOR: Record<ReviewerState, ChipColor> = {
  pending: 'amber',
  approved: 'blue',
  changes_requested: 'red',
  commented: 'gray',
  dismissed: 'gray',
}

const countPending = (panel: ReviewersPanel): number =>
  panel.reviewers.filter((r) => r.state === 'pending').length

/**
 * The same person glyphs the card's ReviewChip uses, so "approved" looks the
 * same wherever it appears - and blue rather than green for the same reason
 * as there: the circled green check is CI's mark.
 */
function StateIcon({ state }: { state: ReviewerState }) {
  switch (state) {
    case 'approved':
      return <UserCheck />
    case 'changes_requested':
      return <UserPen />
    case 'commented':
      return <MessageCircle />
    case 'dismissed':
      return <Ban />
    default:
      return <UserSearch />
  }
}

function Person({ login, name, avatarUrl }: ReviewerCandidate) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-5">
        <AvatarImage src={avatarUrl ?? undefined} />
        <AvatarFallback className="text-[10px]">
          {login.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-xs">{login}</span>
      {name ? <span className="truncate text-xs text-muted-foreground">{name}</span> : null}
    </span>
  )
}

export interface ReviewersButtonProps {
  pr: PullRequestItem
  /** Refreshes the dashboard; requesting a review changes the row's decision. */
  onChanged: () => void
}

/**
 * Who is on the pull request and who else could be. GitHub puts this in a
 * sidebar two clicks away, and it is the thing you want when a PR has sat for
 * a day: which of them has not looked yet, and who else could be asked.
 */
export function ReviewersButton({ pr, onChanged }: ReviewersButtonProps) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<ReviewersPanel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  /** Index into `matches` the arrow keys have reached; -1 = nothing chosen. */
  const [highlight, setHighlight] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  /** The last count read straight from the PR, and the dashboard's number at
   *  the time, so we can tell when the dashboard has caught up. */
  const [observed, setObserved] = useState<{ pending: number; fromDashboard: number } | null>(null)
  const toast = useToast()
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const load = useCallback(
    async (q?: string) => {
      setLoading(true)
      try {
        const next = await api.reviewers(pr.repo.nameWithOwner, pr.number, q)
        if (!live.current) return
        setPanel(next)
        setObserved({
          pending: countPending(next),
          fromDashboard: pr.pendingReviewerCount,
        })
        setError(null)
      } catch (err) {
        if (!live.current) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (live.current) setLoading(false)
      }
    },
    [pr.repo.nameWithOwner, pr.number, pr.pendingReviewerCount],
  )

  useEffect(() => {
    if (open) void load()
    else {
      setQuery('')
      setPanel(null)
    }
    // `observed` deliberately survives a close; see the count below.
  }, [open, load])

  /**
   * The moment the poll disagrees with what we read, it has either caught up
   * or someone else has changed the reviewers - either way our reading is
   * spent, and dropping it here means a count that later churns back to the
   * same number cannot resurrect it.
   */
  useEffect(() => {
    setObserved((current) =>
      current && current.fromDashboard !== pr.pendingReviewerCount ? null : current,
    )
  }, [pr.pendingReviewerCount])

  /**
   * Collaborators come back a hundred at a time, which is the whole list for
   * most repositories, so typing filters what we already have. Only a repo
   * with more than that has to go back to GitHub for the rest.
   */
  useEffect(() => {
    if (!open || !panel?.truncated || query.trim().length < 2) return
    const timer = setTimeout(() => void load(query), 250)
    return () => clearTimeout(timer)
  }, [open, panel?.truncated, query, load])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return panel?.candidates ?? []
    return (panel?.candidates ?? []).filter(
      (c) =>
        c.login.toLowerCase().includes(needle) || (c.name ?? '').toLowerCase().includes(needle),
    )
  }, [panel?.candidates, query])

  // Any refilter drops the highlight: the same index would silently point at
  // a different person.
  useEffect(() => {
    setHighlight(-1)
  }, [matches])

  // Focus stays in the search box, so the list cannot scroll itself; follow
  // the highlight the way a focused row would follow focus.
  useEffect(() => {
    if (highlight < 0) return
    listRef.current?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const edit = async (add: string[], remove: string[], what: string) => {
    setBusy(add[0] ?? remove[0] ?? '')
    try {
      const result = await api.editReviewers(pr.url, add, remove)
      toast(result.ok ? what : result.message, result.ok ? 'success' : 'error')
      if (result.ok) {
        setQuery('')
        await load()
        onChanged()
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      if (live.current) setBusy(null)
    }
  }

  /**
   * The count on the card, in order of how much we trust it.
   *
   * The dashboard's number is only ever as fresh as the last poll: a minute
   * old at worst, and older than that whenever a poll fails, because the
   * poller keeps serving the last good payload behind its error banner. The
   * panel reads the pull request directly, so the moment it has told us the
   * truth we keep that number even after it closes - otherwise the count snaps
   * back to the stale one the instant you dismiss the thing that corrected it.
   *
   * The dashboard wins again as soon as its own number moves, which is how we
   * know it has caught up - or that someone else has changed the reviewers
   * since, which our reading would otherwise paper over indefinitely.
   */
  const pending = panel ? countPending(panel) : (observed?.pending ?? pr.pendingReviewerCount)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="xs"
              aria-label="Request reviewers"
              // The board's `r` shortcut clicks this to open the popover.
              data-card-action="reviewers"
              className={cn('text-sm', BUTTON_SOFT[pending > 0 ? 'amber' : 'gray'])}
            >
              <UserPlus />
              {pending > 0 ? <span className="font-bold">{pending}</span> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {pending > 0
            ? `${pending} reviewer${pending === 1 ? '' : 's'} have not answered yet - see who, or ask someone else`
            : 'Nobody is waiting to review - see who has looked, or ask someone'}
        </TooltipContent>
      </Tooltip>

      <PopoverContent side="top" align="end" className="w-[340px] max-w-[92vw] p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Reviewers</span>
            {loading ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          {error ? <span className="text-xs text-destructive">{error}</span> : null}

          {panel && panel.reviewers.length === 0 && !loading ? (
            <span className="text-xs text-muted-foreground">Nobody has been asked yet.</span>
          ) : null}

          {panel && panel.reviewers.length > 0 ? (
            <div className="flex flex-col gap-1">
              {panel.reviewers.map((reviewer) => (
                <ReviewerRow
                  key={reviewer.login}
                  reviewer={reviewer}
                  busy={busy === reviewer.login}
                  onRemove={() => void edit([], [reviewer.login], `Removed ${reviewer.login}`)}
                  onReRequest={() =>
                    void edit([reviewer.login], [], `Asked ${reviewer.login} again`)
                  }
                />
              ))}
            </div>
          ) : null}

          {panel?.note ? (
            <span className="text-xs text-muted-foreground">{panel.note}</span>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                className="h-7 px-2 text-xs"
                placeholder="Add a reviewer…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                // Combobox keys without moving focus: the arrows walk the
                // candidate list below and Enter adds, so add-by-keyboard is
                // type, arrow, Enter without ever leaving the box.
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setHighlight((current) => Math.min(matches.length - 1, current + 1))
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setHighlight((current) => (current <= 0 ? current : current - 1))
                  } else if (event.key === 'Enter') {
                    // A lone match needs no arrow first; several without a
                    // highlight is an ambiguous Enter, so it does nothing.
                    const pick =
                      highlight >= 0
                        ? matches[highlight]
                        : matches.length === 1
                          ? matches[0]
                          : undefined
                    if (!pick || busy !== null) return
                    event.preventDefault()
                    void edit([pick.login], [], `Asked ${pick.login} to review`)
                  }
                }}
                role="combobox"
                aria-expanded={matches.length > 0}
                aria-controls="reviewer-candidates"
                aria-autocomplete="list"
                aria-activedescendant={
                  highlight >= 0 && matches[highlight]
                    ? `reviewer-candidate-${matches[highlight].login}`
                    : undefined
                }
                autoFocus
              />
              {/* Long collaborator lists scroll; the search box above stays put. */}
              <div ref={listRef} className="max-h-60 overflow-y-auto overscroll-contain">
                {matches.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {panel ? 'No collaborator matches that.' : ''}
                  </span>
                ) : (
                  <div id="reviewer-candidates" role="listbox" className="flex flex-col gap-1">
                    {matches.map((candidate, index) => (
                      <button
                        key={candidate.login}
                        id={`reviewer-candidate-${candidate.login}`}
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        data-highlighted={index === highlight || undefined}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
                          // The keyboard highlight wears the hover coat: one
                          // look for "this row is the one", however reached.
                          index === highlight && 'bg-accent',
                        )}
                        disabled={busy !== null}
                        onClick={() =>
                          void edit([candidate.login], [], `Asked ${candidate.login} to review`)
                        }
                      >
                        <Person {...candidate} />
                        {busy === candidate.login ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Plus className="size-3.5" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ReviewerRow({
  reviewer,
  busy,
  onRemove,
  onReRequest,
}: {
  reviewer: Reviewer
  busy: boolean
  onRemove: () => void
  onReRequest: () => void
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      {/* A login and a real name both want the room, so both may be truncated. */}
      <Person login={reviewer.login} name={reviewer.name} avatarUrl={reviewer.avatarUrl} />
      <span className="flex shrink-0 items-center gap-1">
        {/* Icon-only, sized like the card chips; the word lives in the
            tooltip, the same trade the card's ReviewChip makes. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className={cn('h-6.5 text-sm [&>svg]:size-4', CHIP_SOFT[STATE_COLOR[reviewer.state]])}>
              <StateIcon state={reviewer.state} />
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{STATE_LABEL[reviewer.state]}</TooltipContent>
        </Tooltip>
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {/* Someone who has already answered can be asked again - a review goes
            stale the moment you push, and this is GitHub's re-request arrow. */}
        {!busy && reviewer.state !== 'pending' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onReRequest}>
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Ask ${reviewer.login} to look again`}</TooltipContent>
          </Tooltip>
        ) : null}
        {!busy ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onRemove}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Remove ${reviewer.login}`}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    </div>
  )
}
