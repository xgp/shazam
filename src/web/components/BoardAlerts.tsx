import { useEffect, useRef } from 'react'
import type { DashboardData } from '../../shared/types.js'
import { COLUMNS } from './columns/index.js'
import { useToast } from './Toaster.js'

export interface BoardAlertsProps {
  data: DashboardData | null
  /** The bell in the header; off means silence, not just no desktop pings. */
  enabled: boolean
  /** Select and scroll to a card, for a notification click. */
  onFocusItem: (id: string) => void
}

interface AlertLine {
  tone: 'success' | 'error' | 'info'
  message: string
  itemId: string
}

/**
 * What changed between two polls, said briefly. New arrivals are judged
 * against the whole previous board, not per column, so a card that merely
 * moved columns after one of your own actions stays quiet.
 */
function diffBoard(prev: DashboardData, next: DashboardData): AlertLine[] {
  const lines: AlertLine[] = []

  const prevIds = new Set<string>()
  for (const column of COLUMNS) {
    for (const item of column.select(prev)) prevIds.add(item.id)
  }

  for (const column of COLUMNS) {
    const fresh = column.select(next).filter((item) => !prevIds.has(item.id))
    if (fresh.length === 0) continue
    // One line per column: a single arrival is named, a batch is counted.
    const first = fresh[0]
    if (!first) continue
    lines.push({
      tone: 'info',
      message:
        fresh.length === 1
          ? `${column.title}: ${first.repo.nameWithOwner}#${first.number}`
          : `${fresh.length} new in ${column.title}`,
      itemId: first.id,
    })
  }

  // State transitions, on your own PRs only: other columns churn with other
  // people's work, but checks flipping, a verdict landing, or a conflict
  // appearing on something you authored is always worth a ping.
  const before = new Map(prev.columns.myPullRequests.map((pr) => [pr.id, pr]))
  for (const pr of next.columns.myPullRequests) {
    const old = before.get(pr.id)
    if (!old) continue
    const ref = `${pr.repo.nameWithOwner}#${pr.number}`
    if (old.checks !== 'failure' && pr.checks === 'failure') {
      lines.push({ tone: 'error', message: `Checks failed on ${ref}`, itemId: pr.id })
    } else if (old.checks === 'failure' && pr.checks === 'success') {
      // Recovery only: pending→success fires after every push you make, and
      // being told your own routine push went green is noise.
      lines.push({ tone: 'success', message: `Checks green again on ${ref}`, itemId: pr.id })
    }
    if (old.reviewDecision !== 'approved' && pr.reviewDecision === 'approved') {
      lines.push({ tone: 'success', message: `${ref} approved`, itemId: pr.id })
    }
    if (old.reviewDecision !== 'changes_requested' && pr.reviewDecision === 'changes_requested') {
      lines.push({ tone: 'error', message: `Changes requested on ${ref}`, itemId: pr.id })
    }
    if (old.mergeable !== 'conflicting' && pr.mergeable === 'conflicting') {
      lines.push({ tone: 'error', message: `Merge conflicts on ${ref}`, itemId: pr.id })
    }
  }

  return lines
}

/**
 * Watches the poll stream and surfaces changes: as toasts while the board has
 * focus, as one batched desktop notification per poll when it does not.
 * Renders nothing.
 */
export function BoardAlerts({ data, enabled, onFocusItem }: BoardAlertsProps) {
  const toast = useToast()
  const prevRef = useRef<DashboardData | null>(null)

  useEffect(() => {
    if (!data) return
    // A failed poll re-serves the last good columns with `error` set; keeping
    // the old baseline means recovery diffs against reality, not itself.
    if (data.error) return
    const prev = prevRef.current
    // The baseline always advances, even while alerts are off, so flipping the
    // bell on never replays history.
    prevRef.current = data
    if (!prev || prev.fetchedAt === data.fetchedAt) return
    if (!enabled) return

    const lines = diffBoard(prev, data)
    if (lines.length === 0) return

    const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted'
    // Focus, not visibility: a window behind another app or on another monitor
    // still reports 'visible' unless it is minimized or fully covered, so a
    // visibility check toasts into a window nobody is looking at.
    if (document.hasFocus() || !canNotify) {
      for (const line of lines) toast(line.message, line.tone)
      return
    }

    // One notification per poll, replacing the previous one (tag) rather than
    // piling up in Notification Center while you are away.
    const notification = new Notification('shazam', {
      body: lines.map((line) => line.message).join('\n'),
      tag: 'shazam-board',
    })
    notification.onclick = () => {
      window.focus()
      const first = lines[0]
      if (first) onFocusItem(first.itemId)
      notification.close()
    }
  }, [data, enabled, toast, onFocusItem])

  return null
}
