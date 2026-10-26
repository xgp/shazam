import {
  Ban,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  FileText,
  GitMerge,
  MessageCircle,
  UserCheck,
  UserPen,
  UserSearch,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CheckState, MergeableState, ReviewDecision } from '../../shared/types.js'
import { absoluteTime, relativeTime } from '../lib/format.js'
import { type ChipColor, CHIP_SOFT } from './chips.js'
import { CommentsPopover } from './CommentsPopover.js'

interface ChipProps {
  tooltip: string
  color: ChipColor
  icon: ReactNode
  label?: string
  /** When set the chip becomes a link to the relevant GitHub tab. */
  href?: string
}

function Chip({ tooltip, color, icon, label, href }: ChipProps) {
  const badge = (
    // A pinned height: icon-only chips otherwise collapse to the icon's own
    // box and sit visibly smaller than their labeled neighbors.
    <Badge className={cn('h-6.5 text-sm [&>svg]:size-4', CHIP_SOFT[color])}>
      {icon}
      {label}
    </Badge>
  )

  if (!href) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-inherit no-underline"
          // The whole card is clickable; keep this chip's own destination.
          onClick={(event) => event.stopPropagation()}
        >
          {badge}
        </a>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function ChecksChip({ state, prUrl }: { state: CheckState; prUrl?: string }) {
  const href = prUrl ? `${prUrl}/checks` : undefined
  switch (state) {
    case 'success':
      return (
        <Chip tooltip="All checks passing - open the checks tab" color="green" icon={<CircleCheck />} href={href} />
      )
    case 'failure':
      return (
        <Chip tooltip="Checks failing - open the checks tab" color="red" icon={<CircleX />} href={href} />
      )
    case 'pending':
      return (
        <Chip tooltip="Checks running - open the checks tab" color="amber" icon={<Clock />} href={href} />
      )
    default:
      return <Chip tooltip="No checks reported" color="gray" icon={<CircleMinus />} />
  }
}

export function ReviewChip({ decision }: { decision: ReviewDecision }) {
  switch (decision) {
    // Icon-only, and every glyph is a person: a review verdict is a human
    // verdict, where the circled marks beside these belong to CI. The word
    // lives in the tooltip.
    case 'approved':
      // Deliberately not the green circled check: that is CI's mark, and the
      // two chips sit side by side on a card.
      return <Chip tooltip="Approved" color="blue" icon={<UserCheck />} />
    case 'changes_requested':
      return <Chip tooltip="Changes requested" color="red" icon={<UserPen />} />
    case 'review_required':
      return <Chip tooltip="Review required" color="amber" icon={<UserSearch />} />
    default:
      return null
  }
}

export function MergedChip({ mergedAt, mergedBy }: { mergedAt: string | null; mergedBy: string | null }) {
  if (!mergedAt) return null
  return (
    <Chip
      tooltip={`Merged ${absoluteTime(mergedAt)}${mergedBy ? ` by ${mergedBy}` : ''}`}
      color="violet"
      icon={<GitMerge />}
      label={relativeTime(mergedAt)}
    />
  )
}

export function ConflictChip({ state, prUrl }: { state: MergeableState; prUrl?: string }) {
  if (state !== 'conflicting') return null
  return (
    <Chip
      tooltip="Has merge conflicts - open GitHub's conflict resolver"
      color="red"
      icon={<Ban />}
      label="conflict"
      href={prUrl ? `${prUrl}/conflicts` : undefined}
    />
  )
}

export interface CommentsChipProps {
  count: number
  threads?: number
  /** owner/name and number identify the conversation to read. */
  repo: string
  number: number
  /** The PR or issue, for the overlay's link out. */
  url: string
}

/**
 * The one chip that does not lead to GitHub: it opens the conversation in an
 * overlay at the pointer, because reading three comments should not cost a tab.
 */
export function CommentsChip({ count, threads = 0, repo, number, url }: CommentsChipProps) {
  if (count === 0 && threads === 0) return null
  const counts =
    threads > 0
      ? `${count} comment${count === 1 ? '' : 's'}, ${threads} unresolved review thread${threads === 1 ? '' : 's'}`
      : `${count} comment${count === 1 ? '' : 's'}`

  return (
    <CommentsPopover repo={repo} number={number} url={url}>
      <button
        type="button"
        className="inline-flex cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`${counts} - read them`}
      >
        {/* Inside the button, not around it: the popover's trigger has to be
            the button itself, and the tooltip hands its ref to its own content. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={cn('h-6.5 text-sm [&>svg]:size-4', CHIP_SOFT[threads > 0 ? 'orange' : 'gray'])}
            >
              <MessageCircle />
              {String(threads > 0 ? threads : count)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{`${counts} - click to read them`}</TooltipContent>
        </Tooltip>
      </button>
    </CommentsPopover>
  )
}

export function DraftChip({ isDraft }: { isDraft: boolean }) {
  if (!isDraft) return null
  return <Chip tooltip="Draft pull request" color="gray" icon={<FileText />} />
}

export function DiffStat({
  additions,
  deletions,
  prUrl,
}: {
  additions: number
  deletions: number
  prUrl?: string
}) {
  const counts = (
    <span className="flex items-center gap-1 text-sm">
      <span className="text-emerald-700 dark:text-success">+{additions}</span>
      <span className="text-red-700 dark:text-red-400">-{deletions}</span>
    </span>
  )

  if (!prUrl) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{counts}</TooltipTrigger>
        <TooltipContent>{`+${additions} / -${deletions}`}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={`${prUrl}/files`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-inherit no-underline"
          onClick={(event) => event.stopPropagation()}
        >
          {counts}
        </a>
      </TooltipTrigger>
      <TooltipContent>{`+${additions} / -${deletions} - open the diff`}</TooltipContent>
    </Tooltip>
  )
}
