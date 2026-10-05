import { ChevronDown, Loader2, Zap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentId, AgentSession, IssueItem, PullRequestItem } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { type AgentInfo, primaryAgent } from './agents.js'
import { BUTTON_SOFT } from './chips.js'
import { useToast } from './Toaster.js'

interface SplitProps {
  agents: AgentInfo[]
  /** Config's preference; the primary half opens this one where it exists. */
  defaultAgent: AgentId
  onLaunched: (session: AgentSession) => void
  /** What the row is, for the tooltip and the toast. */
  title: string
  tooltip: (agentLabel: string) => string
  start: (agent: AgentId) => Promise<AgentSession>
}

/**
 * Split button: the primary half launches the configured agent, the caret
 * offers the rest. New agents come from the health report, so adding one is a
 * server-side change only.
 */
function ShazamSplit({ agents, defaultAgent, onLaunched, title, tooltip, start }: SplitProps) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const available = agents.filter((a) => a.available)
  const primary = primaryAgent(agents, defaultAgent)

  const launch = async (agent: AgentId) => {
    setBusy(true)
    try {
      const session = await start(agent)
      onLaunched(session)
      toast(`Shazam: preparing ${title}`, 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!primary) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Tagged even though inert: the shortcut handler checks disabled
              itself, and finding a disabled button beats finding nothing. */}
          <Button size="xs" className={cn('text-sm', BUTTON_SOFT.gray)} disabled data-card-action="shazam">
            <Zap /> Shazam
          </Button>
        </TooltipTrigger>
        <TooltipContent>Neither claude nor codex was found on PATH</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="xs"
            className="rounded-r-none text-sm"
            disabled={busy}
            // Only the primary half: the board's `s` shortcut means "launch
            // the default agent", never "open the agent picker".
            data-card-action="shazam"
            onClick={() => void launch(primary.id)}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Zap />} Shazam
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip(primary.label)}</TooltipContent>
      </Tooltip>
      {available.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="xs"
              className="ml-px rounded-l-none px-1"
              disabled={busy}
              aria-label="Choose agent"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {available.map((agent) => (
              <DropdownMenuItem key={agent.id} onSelect={() => void launch(agent.id)}>
                Open in {agent.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

export interface ShazamButtonProps {
  pr: PullRequestItem
  agents: AgentInfo[]
  defaultAgent: AgentId
  onLaunched: (session: AgentSession) => void
}

export function ShazamButton({ pr, ...rest }: ShazamButtonProps) {
  return (
    <ShazamSplit
      {...rest}
      title={`${pr.repo.nameWithOwner}#${pr.number}`}
      tooltip={(label) => `Clone a worktree for this PR and open ${label}`}
      start={(agent) => api.shazam(pr, agent)}
    />
  )
}

export interface IssueShazamButtonProps {
  issue: IssueItem
  agents: AgentInfo[]
  defaultAgent: AgentId
  onLaunched: (session: AgentSession) => void
}

/**
 * The same button on an issue, which has no branch of its own: the worktree is
 * cut fresh from the repository's default branch, and the agent is told to
 * work out whether the issue is safe to implement on its own - and to open the
 * pull request when it is.
 */
export function IssueShazamButton({ issue, ...rest }: IssueShazamButtonProps) {
  return (
    <ShazamSplit
      {...rest}
      title={`${issue.repo.nameWithOwner}#${issue.number}`}
      tooltip={(label) => `Open ${label} on this issue, on a branch off the default one`}
      start={(agent) => api.shazamIssue(issue, agent)}
    />
  )
}
