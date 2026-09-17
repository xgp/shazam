import { Bell, BellOff, Moon, RefreshCw, Rows3, Rows4, Sun, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AgentSession, ColumnId, DashboardItem } from '../shared/types.js'
import './app.css'
import { BoardAlerts } from './components/BoardAlerts.js'
import { DashboardColumn } from './components/DashboardColumn.js'
import { FilterBar } from './components/FilterBar.js'
import { FilterChips } from './components/FilterChips.js'
import { KeyboardHelp } from './components/KeyboardHelp.js'
import { TerminalDock } from './components/TerminalDock.js'
import { Toaster } from './components/Toaster.js'
import { TokenGate } from './components/TokenGate.js'
import { ViewTabs } from './components/ViewTabs.js'
import { COLUMNS } from './components/columns/index.js'
import type { ColumnContext } from './components/registry.js'
import { ownerOf } from './components/registry.js'
import { useBoardKeys } from './hooks/useBoardKeys.js'
import { useDashboard } from './hooks/useDashboard.js'
import { useHealth } from './hooks/useHealth.js'
import { activeViewQuery, useSavedViews } from './hooks/useSavedViews.js'
import { useSessions } from './hooks/useSessions.js'
import { useAppearance } from './lib/appearance.js'
import { useDensity } from './lib/density.js'
import { matchesFilter, parseFilter } from './lib/filter.js'
import { relativeTime } from './lib/format.js'

const FILTER_KEY = 'shazam.owners'
const COLLAPSED_KEY = 'shazam.collapsed'
const ALERTS_KEY = 'shazam.alerts'

/**
 * How long a row stays hidden after you act on it. Long enough for GitHub's
 * search index to catch up, short enough that a no-op action self-corrects.
 */
const DISMISS_MS = 90_000

/**
 * GitHub's own mark, drawn inline: lucide ships no brand icons, and this is
 * the one place the dashboard needs one.
 */
function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function loadFilter(): Set<string> {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function loadCollapsed(): Set<ColumnId> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    // Ids are validated against the live registry, so a column that was
    // renamed or removed cannot leave a phantom entry behind.
    const known = new Set<string>(COLUMNS.map((column) => column.id))
    return new Set(parsed.filter((id): id is ColumnId => typeof id === 'string' && known.has(id)))
  } catch {
    return new Set()
  }
}

/**
 * The filter text lives in `?q=` rather than localStorage so a filtered view
 * is a shareable URL and a reload lands where you left off. A URL without one
 * resumes the active saved view instead; a URL with one that differs from the
 * view simply shows the view as modified.
 */
function initialQuery(): string {
  return new URLSearchParams(window.location.search).get('q') ?? activeViewQuery()
}

export function App() {
  const [appearance, toggleAppearance] = useAppearance()
  const [density, toggleDensity] = useDensity()
  const health = useHealth()
  const dashboard = useDashboard(health?.pollIntervalMs ?? 60_000)
  const sessions = useSessions()
  const [owners, setOwners] = useState<Set<string>>(loadFilter)
  const [query, setQuery] = useState<string>(initialQuery)
  const savedViews = useSavedViews()
  // Which tile you last touched, so you can find your place after coming back
  // from GitHub or an agent session. Deliberately not persisted: it is a marker
  // for the current sitting, not a saved selection.
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  /**
   * Rows hidden because you just acted on them. A refresh is not enough on its
   * own: GitHub's search index lags, so an approved PR keeps matching
   * `-reviewed-by:@me` for a while and would sit there looking untouched.
   * Entries expire, so anything the action did not actually remove comes back.
   */
  const [dismissed, setDismissed] = useState<Map<string, number>>(new Map())
  // Collapsed columns persist across sessions: which lists you care about is
  // a lasting preference, unlike the per-sitting lastClickedId above.
  const [collapsedColumns, setCollapsedColumns] = useState<Set<ColumnId>>(loadCollapsed)
  const [alertsOn, setAlertsOn] = useState(() => {
    try {
      return localStorage.getItem(ALERTS_KEY) === 'on'
    } catch {
      return false
    }
  })

  const toggleAlerts = useCallback(() => {
    setAlertsOn((current) => {
      const next = !current
      try {
        localStorage.setItem(ALERTS_KEY, next ? 'on' : 'off')
      } catch {
        // storage disabled
      }
      // Ask on enable, not on load: the browser's permission prompt should
      // only ever appear as the direct answer to clicking the bell.
      if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
      return next
    })
  }, [])

  const focusItem = useCallback((id: string) => {
    setLastClickedId(id)
    document
      .querySelector(`[data-item-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  const toggleCollapsed = useCallback((id: ColumnId) => {
    setCollapsedColumns((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // storage disabled
      }
      return next
    })
  }, [])

  const persistOwners = useCallback((next: Set<string>) => {
    setOwners(next)
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify([...next]))
    } catch {
      // storage disabled
    }
  }, [])

  const toggleOwner = useCallback(
    (owner: string) => {
      const next = new Set(owners)
      if (next.has(owner)) next.delete(owner)
      else next.add(owner)
      persistOwners(next)
    },
    [owners, persistOwners],
  )

  const data = dashboard.data

  const parsedQuery = useMemo(() => parseFilter(query), [query])

  // Debounced so typing does not spam the history API; replaceState keeps the
  // filter out of the back button's way.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const url = new URL(window.location.href)
      if (query) url.searchParams.set('q', query)
      else url.searchParams.delete('q')
      window.history.replaceState(null, '', url)
    }, 300)
    return () => window.clearTimeout(handle)
  }, [query])

  useEffect(() => {
    if (dismissed.size === 0) return
    const now = Date.now()
    const live = [...dismissed].filter(([, expiry]) => expiry > now)
    if (live.length !== dismissed.size) setDismissed(new Map(live))
  }, [data, dismissed])

  const ownerCounts = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, number>()
    for (const column of COLUMNS) {
      for (const item of column.select(data)) {
        counts.set(ownerOf(item), (counts.get(ownerOf(item)) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner))
  }, [data])

  const ctx: ColumnContext = useMemo(
    () => ({
      viewer: data?.viewer ?? '',
      agents: health?.agents ?? [],
      defaultMergeMethod: health?.defaultMergeMethod ?? 'squash',
      defaultAgent: health?.defaultAgent ?? 'claude',
      onSessionLaunched: (session: AgentSession) => sessions.add(session),
      onActioned: (itemId: string) => {
        setDismissed((current) => new Map(current).set(itemId, Date.now() + DISMISS_MS))
        void dashboard.refresh()
      },
      onChanged: () => void dashboard.refresh(),
      lastClickedId,
      onTileClicked: setLastClickedId,
    }),
    [
      data?.viewer,
      health?.agents,
      health?.defaultMergeMethod,
      health?.defaultAgent,
      sessions,
      dashboard,
      lastClickedId,
    ],
  )

  // The dot on the active tab: the live filter state has drifted from what
  // the view saved. The All view is fixed, so it never shows one.
  const activeView = savedViews.activeView
  const viewModified =
    activeView !== null &&
    (activeView.q !== query ||
      activeView.owners.length !== owners.size ||
      !activeView.owners.every((owner) => owners.has(owner)))

  const selectView = (id: string) => {
    savedViews.activate(id)
    const view = savedViews.views.find((v) => v.id === id) ?? null
    setQuery(view?.q ?? '')
    persistOwners(new Set(view?.owners ?? []))
  }

  // Memoized (unlike the old per-render filter closure) because the keyboard
  // cursor below needs the same visible lists the columns render - computing
  // them once keeps the two views of "what is on screen" identical.
  const visibleByColumn = useMemo(() => {
    const map = new Map<ColumnId, DashboardItem[]>()
    if (!data) return map
    for (const column of COLUMNS) {
      const visible = column.select(data).filter((item) => !dismissed.has(item.id))
      const byOwner =
        owners.size === 0 ? visible : visible.filter((item) => owners.has(ownerOf(item)))
      map.set(
        column.id,
        byOwner.filter((item) => matchesFilter(item, parsedQuery)),
      )
    }
    return map
  }, [data, dismissed, owners, parsedQuery])

  // The keyboard cursor's view of the board, in render order: j/k flatten it
  // into reading order, the arrows keep the column structure. Collapsed
  // columns render no cards, so the cursor skips them entirely.
  const cursorColumns = useMemo(
    () =>
      COLUMNS.filter((column) => !collapsedColumns.has(column.id)).map((column) => ({
        columnId: column.id,
        items: (visibleByColumn.get(column.id) ?? []).map((item) => ({
          id: item.id,
          url: item.url,
        })),
      })),
    [visibleByColumn, collapsedColumns],
  )

  useBoardKeys(cursorColumns, lastClickedId, setLastClickedId)

  if (dashboard.unauthorized) {
    return (
      <TooltipProvider delayDuration={300}>
        <TokenGate />
      </TooltipProvider>
    )
  }

  const toolWarnings = (health?.tools ?? []).filter((tool) => tool.status !== 'ok')

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster>
        <div className="flex h-screen flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            <GitHubIcon />
            <h1 className="text-lg font-semibold">shazam</h1>
            {data?.viewer ? (
              <span className="text-sm text-muted-foreground">{data.viewer}</span>
            ) : null}

            <div className="flex flex-1 justify-center">
              <FilterChips
                owners={ownerCounts}
                selected={owners}
                onToggle={toggleOwner}
                onClear={() => persistOwners(new Set())}
              />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-pressed={alertsOn}
                  onClick={toggleAlerts}
                >
                  {alertsOn ? <Bell /> : <BellOff />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {!alertsOn
                  ? 'Alerts off'
                  : typeof Notification !== 'undefined' && Notification.permission === 'denied'
                    ? 'Alerts on - desktop notifications blocked by the browser, so toasts only'
                    : 'Alerts on: new cards, and state changes on your PRs'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  disabled={dashboard.refreshing}
                  onClick={() => void dashboard.refresh()}
                >
                  {dashboard.refreshing ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
                </Button>
              </TooltipTrigger>
              {/* The freshness and rate-limit readouts live here rather than as
                  their own header text: they answer "should I refresh?", which
                  is a question you ask at this button. */}
              <TooltipContent>
                <div className="flex flex-col gap-0.5">
                  <span>Refresh now</span>
                  {data ? <span className="opacity-80">Updated {relativeTime(data.fetchedAt)}</span> : null}
                  {data?.rateLimit ? (
                    <span className="opacity-80">
                      {`GitHub API: ${data.rateLimit.remaining} of ${data.rateLimit.limit} left, resets ${relativeTime(data.rateLimit.resetAt)}`}
                    </span>
                  ) : null}
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={toggleDensity}
                >
                  {/* Like the theme toggle, the icon shows where the click
                      takes you, not where you are. */}
                  {density === 'compact' ? <Rows3 /> : <Rows4 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {density === 'compact' ? 'Switch to comfortable' : 'Switch to compact'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={toggleAppearance}
                >
                  {appearance === 'dark' ? <Sun /> : <Moon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {appearance === 'dark' ? 'Switch to light' : 'Switch to dark'}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
            <ViewTabs
              views={savedViews.views}
              activeId={savedViews.activeId}
              modified={viewModified}
              onSelect={selectView}
              onSave={(name) => savedViews.save(name, query, [...owners])}
              onUpdate={() => {
                if (activeView) savedViews.update(activeView.id, query, [...owners])
              }}
              onRename={savedViews.rename}
              onDelete={savedViews.remove}
            />
            <FilterBar value={query} onChange={setQuery} />
          </div>

          {dashboard.error || data?.error || toolWarnings.length > 0 ? (
            <div className="flex flex-col gap-1 px-4 pt-3">
              {dashboard.error ? (
                <Alert variant="destructive" className="border-destructive/50 px-3 py-2">
                  <TriangleAlert />
                  <AlertDescription>
                    Cannot reach the shazam server: {dashboard.error}
                  </AlertDescription>
                </Alert>
              ) : null}
              {data?.error ? (
                <Alert variant="destructive" className="border-destructive/50 px-3 py-2">
                  <TriangleAlert />
                  <AlertDescription>Last poll failed: {data.error}</AlertDescription>
                </Alert>
              ) : null}
              {toolWarnings.map((tool) => (
                <Alert
                  key={tool.name}
                  className="border-warning/50 px-3 py-2 text-amber-700 dark:text-warning"
                >
                  <TriangleAlert />
                  <AlertDescription className="text-amber-700 dark:text-warning">
                    {tool.name}: {tool.detail ?? tool.status}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          ) : null}

          {/* The row takes the space the dock leaves. Columns hold a fixed
              width, the row scrolls sideways when they overflow the window,
              and each column still scrolls vertically on its own.
              data-density + group/density is how the cards learn the density:
              one attribute here, group variants down in the leaves, and no
              prop has to thread through the column registry. */}
          <div
            className="group/density flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto px-4 py-3"
            data-density={density}
          >
            {COLUMNS.map((column) => {
              const all = data ? column.select(data) : []
              const items = visibleByColumn.get(column.id) ?? []
              return (
                <DashboardColumn
                  key={column.id}
                  column={column}
                  items={items}
                  hiddenCount={all.length - items.length}
                  // Only before the first poll: a failed poll shows its own
                  // callout, and endless skeletons under it would read as
                  // progress that is not being made.
                  loading={!data && !dashboard.error}
                  ctx={ctx}
                  collapsed={collapsedColumns.has(column.id)}
                  onToggleCollapse={() => toggleCollapsed(column.id)}
                />
              )
            })}
          </div>

          <TerminalDock
            sessions={sessions.sessions}
            activeId={sessions.activeId}
            appearance={appearance}
            onSelect={sessions.setActiveId}
            onClose={(id) => void sessions.close(id)}
            fontSize={health?.terminalFontSize ?? 20}
            onStatus={(session) => sessions.update(session)}
          />
          <KeyboardHelp />
          <BoardAlerts data={data} enabled={alertsOn} onFocusItem={focusItem} />
        </div>
      </Toaster>
    </TooltipProvider>
  )
}
