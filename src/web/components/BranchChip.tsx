import { GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PullRequestItem } from '../../shared/types.js'

/**
 * Where a PR is coming from and going to, at a glance: `head → base`. A fork's
 * head is prefixed with its owner, the way GitHub writes it, so a same-named
 * branch from someone else's fork does not read as yours. Long head names
 * truncate; the tooltip always has both in full.
 */
export function BranchChip({ pr }: { pr: Pick<PullRequestItem, 'repo' | 'headRepo' | 'headRef' | 'baseRef'> }) {
  const fork =
    pr.headRepo !== null && pr.headRepo.nameWithOwner !== pr.repo.nameWithOwner
      ? pr.headRepo.nameWithOwner.split('/')[0]
      : null
  const head = fork ? `${fork}:${pr.headRef}` : pr.headRef

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          data-testid="branch-chip"
          className="max-w-full min-w-0 shrink gap-1 px-1.5 font-mono text-[11px] font-normal text-muted-foreground"
        >
          <GitBranch />
          <span className="min-w-0 truncate">{head}</span>
          <span aria-hidden className="opacity-60">
            →
          </span>
          <span className="shrink-0">{pr.baseRef}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {fork ? pr.headRepo!.nameWithOwner : pr.repo.nameWithOwner}:{pr.headRef} into{' '}
        {pr.repo.nameWithOwner}:{pr.baseRef}
      </TooltipContent>
    </Tooltip>
  )
}
