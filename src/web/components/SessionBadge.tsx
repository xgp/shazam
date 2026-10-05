import { Loader2, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentSession } from '../../shared/types.js'
import { CHIP_SOLID } from './chips.js'

/**
 * How a session reads at a glance, in one place so the badge on a card and the
 * tab in the dock cannot describe the same session differently.
 */
export function sessionLook(session: AgentSession): {
  tone: keyof typeof CHIP_SOLID
  label: string
  /** True while the agent is sitting there wanting something from you. */
  waiting: boolean
} {
  if (session.status === 'preparing') return { tone: 'amber', label: 'preparing', waiting: false }
  if (session.status === 'failed') return { tone: 'red', label: 'failed', waiting: false }
  if (session.status === 'exited') return { tone: 'gray', label: 'exited', waiting: false }
  return session.activity === 'waiting'
    ? { tone: 'amber', label: 'waiting for you', waiting: true }
    : { tone: 'green', label: 'working', waiting: false }
}

export interface SessionBadgeProps {
  session: AgentSession
  /** Brings the dock to this session's tab. */
  onReveal: (sessionId: string) => void
}

/**
 * Sits among a row's chips whenever an agent is running on it, so a board full
 * of sessions tells you where each one came from. The pulse is reserved for
 * the one state you can do something about.
 */
export function SessionBadge({ session, onReveal }: SessionBadgeProps) {
  const look = sessionLook(session)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          aria-label={`${session.agent} session ${look.label} - show it`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onReveal(session.id)
          }}
        >
          <Badge
            className={cn(
              CHIP_SOLID[look.tone],
              'gap-1',
              // Only while it wants you: a pulse that is always on is wallpaper.
              look.waiting && 'animate-session-wait',
            )}
          >
            {look.waiting ? <Zap className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
            {session.agent}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {look.waiting
          ? `${session.agent} is waiting for you - click to open the session`
          : `${session.agent} is ${look.label} - click to open the session`}
      </TooltipContent>
    </Tooltip>
  )
}
