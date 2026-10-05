import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { IssueItem } from '../../shared/types.js'
import { absoluteTime, relativeTime } from '../lib/format.js'
import { AuthorAvatar } from './AuthorAvatar.js'
import { CloseIssueButton } from './CloseIssueButton.js'
import { CopyLinkButton } from './CopyLinkButton.js'
import { SessionBadge } from './SessionBadge.js'
import { IssueShazamButton } from './ShazamButton.js'
import { CommentsChip } from './StatusIcons.js'
import { useCardLink } from './useCardLink.js'
import type { ColumnContext } from './registry.js'

/**
 * GitHub label colors are authored against a solid swatch, so using one as text
 * color leaves pastels unreadable on a light background. Fill the badge and
 * pick the text color by luminance, the way GitHub itself does.
 */
function labelColors(hex: string): { background: string; color: string } {
  const value = Number.parseInt(hex, 16)
  if (!Number.isFinite(value) || hex.length !== 6) {
    return { background: 'var(--secondary)', color: 'var(--foreground)' }
  }
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  // Rec. 709 relative luminance, the usual threshold for this decision.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return { background: `#${hex}`, color: luminance > 0.6 ? '#1c2024' : '#ffffff' }
}

export function IssueCard({ issue, ctx }: { issue: IssueItem; ctx: ColumnContext }) {
  const link = useCardLink({
    id: issue.id,
    url: issue.url,
    isLastClicked: ctx.lastClickedId === issue.id,
    onClicked: () => ctx.onTileClicked(issue.id),
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
            {issue.repo.nameWithOwner} #{issue.number}
          </span>
          <div className="min-w-0">
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="text-base font-medium text-primary group-hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-data-[density=compact]/density:text-sm"
            >
              {issue.title} <ExternalLink className="inline size-3.5 align-[-2px] opacity-50" />
            </a>
            <CopyLinkButton url={issue.url} what={`${issue.repo.nameWithOwner} #${issue.number}`} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                {relativeTime(issue.updatedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{absoluteTime(issue.updatedAt)}</TooltipContent>
          </Tooltip>
          {/* Only for other people's work: your own avatar on your own issue
              would say nothing. Same gate the old `· author` suffix used. */}
          {issue.author && issue.author !== ctx.viewer ? (
            <AuthorAvatar login={issue.author} />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ctx.sessionsByItem.get(issue.id) ? (
          <SessionBadge
            session={ctx.sessionsByItem.get(issue.id)!}
            onReveal={ctx.onRevealSession}
          />
        ) : null}
        <CommentsChip
          count={issue.commentCount}
          repo={issue.repo.nameWithOwner}
          number={issue.number}
          url={issue.url}
        />
        {issue.labels.slice(0, 3).map((label) => (
          <Badge key={label.name} className="text-sm" style={labelColors(label.color)}>
            {label.name}
          </Badge>
        ))}
      </div>

      <div className="mt-1.5 flex items-center justify-end gap-2">
        <IssueShazamButton
          issue={issue}
          agents={ctx.agents}
          defaultAgent={ctx.defaultAgent}
          onLaunched={ctx.onSessionLaunched}
        />
        <CloseIssueButton issue={issue} onDone={() => ctx.onActioned(issue.id)} />
      </div>
    </Card>
  )
}
