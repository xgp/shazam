import { AtSign, Check, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { PullRequestItem, Reviewer } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { BUTTON_SOFT } from './chips.js'
import { Person } from './ReviewersButton.js'
import { useToast } from './Toaster.js'

const DEFAULT_MESSAGE = 'could you take a look when you get a chance?'

/** `@login` for a person, `@org/team` for a team - GitHub resolves both. */
const mentions = (logins: string[]) => logins.map((login) => `@${login}`).join(' ')

export interface PingReviewersButtonProps {
  pr: PullRequestItem
  /** Refreshes the dashboard; the comment moves the card's comment count. */
  onDone: () => void
}

/**
 * A nudge in the PR's conversation that @mentions its reviewers. A
 * re-request only lights up GitHub's review queue; a mention lands in their
 * notifications and email, which is what a PR that has sat for a day needs.
 * Whoever has not answered yet is ticked by default.
 */
export function PingReviewersButton({ pr, onDone }: PingReviewersButtonProps) {
  const [open, setOpen] = useState(false)
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const panel = await api.reviewers(pr.repo.nameWithOwner, pr.number)
      if (!live.current) return
      setReviewers(panel.reviewers)
      setSelected(new Set(panel.reviewers.filter((r) => r.state === 'pending').map((r) => r.login)))
      setError(null)
    } catch (err) {
      if (!live.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (live.current) setLoading(false)
    }
  }, [pr.repo.nameWithOwner, pr.number])

  useEffect(() => {
    if (open) void load()
    else {
      setReviewers(null)
      setMessage(DEFAULT_MESSAGE)
    }
  }, [open, load])

  const toggle = (login: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(login)) next.delete(login)
      else next.add(login)
      return next
    })

  // Registry order, not click order, so the comment reads the same however
  // the boxes were ticked.
  const chosen = (reviewers ?? []).map((r) => r.login).filter((login) => selected.has(login))
  const body = `${mentions(chosen)} ${message.trim()}`.trim()
  const canSend = chosen.length > 0 && !sending

  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const result = await api.comment(pr.url, body)
      toast(
        result.ok
          ? `Pinged ${mentions(chosen)} on ${pr.repo.nameWithOwner}#${pr.number}`
          : result.message,
        result.ok ? 'success' : 'error',
      )
      if (result.ok) {
        setOpen(false)
        onDone()
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      if (live.current) setSending(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="xs"
              aria-label="Ping reviewers in a comment"
              // The board's `p` shortcut clicks this to open the popover.
              data-card-action="ping"
              className={cn('text-sm', BUTTON_SOFT.gray)}
            >
              <AtSign />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Ping reviewers - @mention them in a comment</TooltipContent>
      </Tooltip>

      <PopoverContent side="top" align="end" className="w-[340px] max-w-[92vw] p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Ping reviewers</span>
            {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          </div>

          {error ? <span className="text-xs text-destructive">{error}</span> : null}

          {reviewers && reviewers.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nobody is on this PR yet - add a reviewer first.
            </span>
          ) : null}

          {reviewers && reviewers.length > 0 ? (
            <>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain">
                {reviewers.map((reviewer) => {
                  const on = selected.has(reviewer.login)
                  return (
                    <button
                      key={reviewer.login}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(reviewer.login)}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <Person {...reviewer} />
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          on && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {on ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>

              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={2}
                className="text-xs"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />

              {/* The comment exactly as it will land, mentions included. */}
              <p className="rounded-md bg-secondary px-2 py-1.5 text-xs break-words text-secondary-foreground">
                {chosen.length > 0 ? body : 'Tick someone to mention.'}
              </p>

              <div className="flex justify-end">
                <Button size="xs" disabled={!canSend} onClick={() => void send()}>
                  {sending ? <Loader2 className="animate-spin" /> : <AtSign />}
                  Comment
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
