import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentSession, PullRequestItem } from '../../shared/types.js'
import { absoluteTime, relativeTime } from '../lib/format.js'
import { FixChangesButton, FixConflictButton } from './AgentFixButton.js'
import { ApproveButton } from './ApproveButton.js'
import { AuthorAvatar } from './AuthorAvatar.js'
import { CopyLinkButton } from './CopyLinkButton.js'
import { MergeButton } from './MergeButton.js'
import { ReviewersButton } from './ReviewersButton.js'
import { SessionBadge } from './SessionBadge.js'
import { ShazamButton } from './ShazamButton.js'
import {
  ChecksChip,
  CommentsChip,
  ConflictChip,
  DiffStat,
  DraftChip,
  ReviewChip,
} from './StatusIcons.js'
import { useCardLink } from './useCardLink.js'
import type { ColumnContext } from './registry.js'

export interface PrCardProps {
  pr: PullRequestItem
  ctx: ColumnContext
  /** Which primary action this column offers alongside shazam. */
  action: 'merge' | 'approve' | 'none'
}

export function PrCard({ pr, ctx, action }: PrCardProps) {
  const onLaunched = (session: AgentSession) => ctx.onSessionLaunched(session)
  const link = useCardLink({
    id: pr.id,
    url: pr.url,
    isLastClicked: ctx.lastClickedId === pr.id,
    onClicked: () => ctx.onTileClicked(pr.id),
  })

  return (
    <Card
      {...link}
      className={cn(
        'gap-2 rounded-lg p-3 group-data-[density=compact]/density:gap-1 group-data-[density=compact]/density:p-2',
        link.className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Long titles must wrap rather than push the timestamp off the card. */}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-muted-foreground">
            {pr.repo.nameWithOwner} #{pr.number}
          </span>
          <div className="min-w-0">
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="text-base font-medium text-primary group-hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-data-[density=compact]/density:text-sm"
            >
              {pr.title} <ExternalLink className="inline size-3.5 align-[-2px] opacity-50" />
            </a>
            <CopyLinkButton url={pr.url} what={`${pr.repo.nameWithOwner} #${pr.number}`} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                {relativeTime(pr.updatedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{absoluteTime(pr.updatedAt)}</TooltipContent>
          </Tooltip>
          {/* Only for other people's work: your own avatar on your own PR
              would say nothing. Same gate the old `· author` suffix used. */}
          {pr.author && pr.author !== ctx.viewer ? <AuthorAvatar login={pr.author} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ctx.sessionsByItem.get(pr.id) ? (
          <SessionBadge
            session={ctx.sessionsByItem.get(pr.id)!}
            onReveal={ctx.onRevealSession}
          />
        ) : null}
        <DraftChip isDraft={pr.isDraft} />
        <ChecksChip state={pr.checks} prUrl={pr.url} />
        <ReviewChip decision={pr.reviewDecision} />
        {pr.reviewDecision === 'changes_requested' ? (
          <FixChangesButton
            pr={pr}
            agents={ctx.agents}
            defaultAgent={ctx.defaultAgent}
            onLaunched={onLaunched}
          />
        ) : null}
        <ConflictChip state={pr.mergeable} prUrl={pr.url} />
        {pr.mergeable === 'conflicting' ? (
          <FixConflictButton
            pr={pr}
            agents={ctx.agents}
            defaultAgent={ctx.defaultAgent}
            onLaunched={onLaunched}
          />
        ) : null}
        <CommentsChip
          count={pr.commentCount}
          threads={pr.unresolvedThreadCount}
          repo={pr.repo.nameWithOwner}
          number={pr.number}
          url={pr.url}
        />
        <DiffStat additions={pr.additions} deletions={pr.deletions} prUrl={pr.url} />
      </div>

      {/* mt-1.5 on top of the card's gap: the buttons read as their own row,
          not part of the chip cluster. */}
      <div className="mt-1.5 flex items-center justify-end gap-2">
        {action === 'merge' ? <ReviewersButton pr={pr} onChanged={ctx.onChanged} /> : null}
        <ShazamButton
          pr={pr}
          agents={ctx.agents}
          defaultAgent={ctx.defaultAgent}
          onLaunched={onLaunched}
        />
        {action === 'merge' ? (
          <MergeButton pr={pr} defaultMethod={ctx.defaultMergeMethod} onDone={() => ctx.onActioned(pr.id)} />
        ) : null}
        {action === 'approve' ? <ApproveButton pr={pr} onDone={() => ctx.onActioned(pr.id)} /> : null}
      </div>
    </Card>
  )
}
