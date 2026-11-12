import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  ChevronUp,
  Columns3,
  Monitor,
  Moon,
  MoreVertical,
  RefreshCw,
  Rows3,
  Rows4,
  SlidersHorizontal,
  Sun,
  TerminalSquare,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { AgentSession, ColumnId, DashboardItem, RateLimit } from '../../../shared/types.js'
import type { Density } from '../../lib/density.js'
import { relativeTime } from '../../lib/format.js'
import { CHIP_SOLID } from '../chips.js'
import { FilterBar } from '../FilterBar.js'
import { FilterChips } from '../FilterChips.js'
import type { ColumnContext, ColumnDef } from '../registry.js'
import { sessionLook } from '../SessionBadge.js'
import { MobileTerminal } from './MobileTerminal.js'

export interface MobileShellProps {
  viewer: string
  columns: ColumnDef[]
  visibleByColumn: Map<ColumnId, DashboardItem[]>
  loading: boolean
  ctx: ColumnContext
  query: string
  onQuery: (q: string) => void
  owners: { owner: string; count: number }[]
  selectedOwners: Set<string>
  onToggleOwner: (owner: string) => void
  onClearOwners: () => void
  /** The saved-view tabs, built by App so both layouts share one instance. */
  viewTabs: ReactNode
  /** Error and warning callouts, likewise. */
  alerts: ReactNode
  fetchedAt: string | null
  rateLimit: RateLimit | null
  refreshing: boolean
  onRefresh: () => void
  alertsOn: boolean
  onToggleAlerts: () => void
  themePreference: 'system' | 'light' | 'dark'
  appearance: 'light' | 'dark'
  onCycleTheme: () => void
  density: Density
  onToggleDensity: () => void
  onNudgeColumn: (id: ColumnId, step: -1 | 1) => void
  columnOrderCustom: boolean
  onResetColumnOrder: () => void
  sessions: AgentSession[]
  activeId: string | null
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onSessionStatus: (session: AgentSession) => void
  onSessionsChanged: () => void
  terminalOpen: boolean
  onTerminalOpen: (open: boolean) => void
  /** Scrolls the board to a card, swiping to its column on the way. */
  onShowItem: (itemId: string) => void
}

function OverflowMenu(props: MobileShellProps & { onReorder: () => void }) {
  const ThemeIcon =
    props.themePreference === 'system' ? Monitor : props.themePreference === 'dark' ? Moon : Sun
  const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Menu">
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* What the desktop shows in the refresh button's tooltip, which a
            touch screen never hovers. */}
        <DropdownMenuLabel className="flex flex-col gap-0.5 text-xs font-normal text-muted-foreground">
          {props.fetchedAt ? <span>Updated {relativeTime(props.fetchedAt)}</span> : <span>Not loaded yet</span>}
          {props.rateLimit ? (
            <span>
              GitHub API: {props.rateLimit.remaining} of {props.rateLimit.limit} left, resets{' '}
              {relativeTime(props.rateLimit.resetAt)}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onToggleAlerts}>
          {props.alertsOn ? <Bell /> : <BellOff />}
          {props.alertsOn ? (denied ? 'Alerts on (toasts only)' : 'Alerts on') : 'Alerts off'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onToggleDensity}>
          {props.density === 'compact' ? <Rows3 /> : <Rows4 />}
          {props.density === 'compact' ? 'Comfortable cards' : 'Compact cards'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onCycleTheme}>
          <ThemeIcon />
          {props.themePreference === 'system'
            ? `Theme: follows the OS (${props.appearance})`
            : `Theme: ${props.themePreference}`}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onReorder}>
          <Columns3 />
          Reorder columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Column drag-and-drop is a desktop gesture (and HTML5 drag does not fire on
 * touch at all), so on a phone the order is edited as a list.
 */
function ReorderDialog({
  open,
  onOpenChange,
  columns,
  onNudge,
  custom,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: ColumnDef[]
  onNudge: (id: ColumnId, step: -1 | 1) => void
  custom: boolean
  onReset: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>Reorder columns</DialogTitle>
          <DialogDescription>The order the tabs appear in, here and on the desktop board.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-1">
          {columns.map((column, i) => (
            <li key={column.id} className="flex items-center gap-2 rounded-md border px-3 py-1">
              {column.dot ? <span className={cn('size-2 shrink-0 rounded-full', column.dot)} /> : null}
              <span className="min-w-0 flex-1 truncate text-sm">{column.title}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${column.title} up`}
                disabled={i === 0}
                onClick={() => onNudge(column.id, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${column.title} down`}
                disabled={i === columns.length - 1}
                onClick={() => onNudge(column.id, 1)}
              >
                <ArrowDown />
              </Button>
            </li>
          ))}
        </ol>
        {custom ? (
          <Button variant="outline" onClick={onReset}>
            Reset to the default order
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FilterToggle({
  open,
  active,
  onToggle,
  className,
}: {
  open: boolean
  active: number
  onToggle: () => void
  className?: string
}) {
  return (
    <Button
      variant={open || active ? 'secondary' : 'ghost'}
      size="icon"
      aria-label="Filters and views"
      aria-expanded={open}
      onClick={onToggle}
      className={cn('relative shrink-0', className)}
    >
      <SlidersHorizontal />
      {active ? (
        <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
          {active}
        </span>
      ) : null}
    </Button>
  )
}

function ColumnBody({ column, props }: { column: ColumnDef; props: MobileShellProps }) {
  const items = props.visibleByColumn.get(column.id) ?? []
  if (items.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
        {props.loading ? 'Loading…' : column.empty}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2 group-data-[density=compact]/density:gap-1">
      {items.map((item) => column.renderItem(item, props.ctx))}
    </div>
  )
}

/** One line for the session bar: the session that wants you, if any does. */
function sessionSummary(sessions: AgentSession[]): string {
  const waiting = sessions.filter((s) => sessionLook(s).waiting)
  if (waiting.length === 1) return `${waiting[0]!.title} is waiting for you`
  if (waiting.length > 1) return `${waiting.length} sessions waiting for you`
  const working = sessions.filter((s) => s.status === 'running' || s.status === 'preparing').length
  if (working) return `${working} working`
  return sessions.length === 1 ? '1 session' : `${sessions.length} sessions`
}

/**
 * The phone layout: one column per screen, swiped between, under a tab strip
 * that follows along. Everything else the desktop header carries folds into a
 * filter panel and an overflow menu; the terminal dock becomes a bar that
 * opens a full-screen terminal.
 */
export function MobileShell(props: MobileShellProps) {
  const pager = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [reorderOpen, setReorderOpen] = useState(false)
  const pushed = useRef(false)
  const { terminalOpen, onTerminalOpen } = props

  // The pager drives the tab strip: swipe, and the matching tab lights up and
  // scrolls into view.
  const onScroll = () => {
    const el = pager.current
    if (!el || el.clientWidth === 0) return
    const next = Math.round(el.scrollLeft / el.clientWidth)
    if (next !== index) setIndex(next)
  }
  useEffect(() => {
    strip.current
      ?.querySelector(`[data-tab="${index}"]`)
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [index])

  const goTo = (i: number) => {
    const el = pager.current
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }

  // The phone's back gesture should leave the terminal, not shazam. Opening it
  // pushes a history entry that popping closes.
  useEffect(() => {
    if (!terminalOpen) return
    if (!pushed.current) {
      window.history.pushState({ shazamTerminal: true }, '')
      pushed.current = true
    }
    const onPop = () => {
      pushed.current = false
      onTerminalOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [terminalOpen, onTerminalOpen])

  const closeTerminal = useCallback(() => {
    if (pushed.current) window.history.back()
    else onTerminalOpen(false)
  }, [onTerminalOpen])

  const active = props.sessions.find((s) => s.id === props.activeId) ?? props.sessions[0] ?? null
  const filterCount = props.selectedOwners.size

  // The last session ended from somewhere else (the desktop, or it exited and
  // was cleaned up): leave the terminal rather than show an empty one.
  useEffect(() => {
    if (terminalOpen && !active) closeTerminal()
  }, [terminalOpen, active, closeTerminal])

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}
      >
        <h1 className="text-base font-semibold">shazam</h1>
        <span className="truncate text-xs text-muted-foreground short:hidden">{props.viewer}</span>
        {/* Landscape on a phone leaves ~350px of height, so the search moves
            up here instead of taking a row, and the column hints go. */}
        <div className="hidden min-w-0 flex-1 items-center gap-1 short:flex">
          <FilterBar value={props.query} onChange={props.onQuery} />
          <FilterToggle open={filtersOpen} active={filterCount} onToggle={() => setFiltersOpen((o) => !o)} />
        </div>
        <div className="flex-1 short:hidden" />
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Refresh"
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          <RefreshCw className={cn(props.refreshing && 'animate-spin')} />
        </Button>
        <OverflowMenu {...props} onReorder={() => setReorderOpen(true)} />
      </div>

      <div className="shrink-0 border-b">
        <div className="flex items-center gap-2 px-3 py-2 short:hidden">
          <FilterBar value={props.query} onChange={props.onQuery} />
          <FilterToggle open={filtersOpen} active={filterCount} onToggle={() => setFiltersOpen((o) => !o)} />
        </div>
        {filtersOpen ? (
          <div className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto px-3 pt-2 pb-3">
            <div>
              <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Views</div>
              {props.viewTabs}
            </div>
            {props.owners.length > 1 ? (
              <div>
                <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Owners</div>
                <FilterChips
                  owners={props.owners}
                  selected={props.selectedOwners}
                  onToggle={props.onToggleOwner}
                  onClear={props.onClearOwners}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {props.alerts}

      <div
        ref={strip}
        role="tablist"
        aria-label="Columns"
        className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none]"
      >
        {props.columns.map((column, i) => {
          const count = props.visibleByColumn.get(column.id)?.length ?? 0
          return (
            <button
              key={column.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              data-tab={i}
              onClick={() => goTo(i)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm whitespace-nowrap short:h-8',
                i === index
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground',
              )}
            >
              {column.dot ? <span className={cn('size-2 rounded-full', column.dot)} /> : null}
              {column.title}
              <Badge className="min-w-5 justify-center bg-accent px-1 text-accent-foreground tabular-nums">
                {props.loading ? '–' : count}
              </Badge>
            </button>
          )
        })}
      </div>

      <div
        ref={pager}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none]"
      >
        {props.columns.map((column) => (
          <section
            key={column.id}
            role="tabpanel"
            aria-label={column.title}
            className="h-full w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain px-3 py-3"
          >
            <p className="mb-2 text-xs text-muted-foreground short:hidden">{column.hint}</p>
            <ColumnBody column={column} props={props} />
          </section>
        ))}
      </div>

      {props.sessions.length ? (
        <button
          type="button"
          onClick={() => onTerminalOpen(true)}
          className="flex shrink-0 items-center gap-2 border-t bg-card px-3 pt-2 text-left"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          <TerminalSquare className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex shrink-0 -space-x-1">
            {props.sessions.slice(0, 3).map((s) => {
              const look = sessionLook(s)
              return (
                <Badge key={s.id} className={cn(CHIP_SOLID[look.tone], look.waiting && 'animate-session-wait')}>
                  {s.agent}
                </Badge>
              )
            })}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{sessionSummary(props.sessions)}</span>
          <ChevronUp className="size-5 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      <ReorderDialog
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        columns={props.columns}
        onNudge={props.onNudgeColumn}
        custom={props.columnOrderCustom}
        onReset={props.onResetColumnOrder}
      />

      {terminalOpen && active ? (
        <MobileTerminal
          sessions={props.sessions}
          active={active}
          appearance={props.appearance}
          onSelect={props.onSelectSession}
          onClose={(id) => {
            if (props.sessions.length <= 1) closeTerminal()
            props.onCloseSession(id)
          }}
          onBack={closeTerminal}
          onStatus={props.onSessionStatus}
          onShowItem={(itemId) => {
            closeTerminal()
            props.onShowItem(itemId)
          }}
          onSessionsChanged={props.onSessionsChanged}
        />
      ) : null}
    </div>
  )
}
