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
import type { AgentId, AgentSession, PullRequestItem } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { type AgentInfo, primaryAgent } from './agents.js'
import { BUTTON_SOFT } from './chips.js'
import { useToast } from './Toaster.js'

export interface ShazamButtonProps {
  pr: PullRequestItem
  agents: AgentInfo[]
  /** Config's preference; the primary half opens this one where it exists. */
  defaultAgent: AgentId
  onLaunched: (session: AgentSession) => void
}

/**
 * Split button: the primary half launches the configured agent, the caret
 * offers the rest. New agents come from the health report, so adding one is a
 * server-side change only.
 */
export function ShazamButton({ pr, agents, defaultAgent, onLaunched }: ShazamButtonProps) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const available = agents.filter((a) => a.available)
  const primary = primaryAgent(agents, defaultAgent)

  const launch = async (agent: AgentId) => {
    setBusy(true)
    try {
      const session = await api.shazam(pr, agent)
      onLaunched(session)
      toast(`Shazam: preparing ${pr.repo.nameWithOwner}#${pr.number}`, 'info')
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
        <TooltipContent>{`Clone a worktree for this PR and open ${primary.label}`}</TooltipContent>
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
