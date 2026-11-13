import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  MoreVertical,
  PanelBottom,
  PanelRight,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentSession } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { CHIP_SOLID } from './chips.js'
import { sessionLook } from './SessionBadge.js'
import { TerminalPane } from './TerminalPane.js'
import { useToast } from './Toaster.js'

export type DockPosition = 'bottom' | 'right'

const MIN_HEIGHT = 140
/** Leave at least this much of the lists visible above the dock. */
const MIN_LISTS_VISIBLE = 160

const MIN_WIDTH = 320
/** Leave at least this much of the board visible beside a right-hand dock. */
const MIN_BOARD_VISIBLE = 320
const WIDTH_KEY = 'shazam.dockWidth'

/** A new session opens the dock across the bottom half of the window. */
const halfWindow = () => Math.round(window.innerHeight / 2)

/** Narrowest either half of a split may be dragged (side by side / stacked). */
const MIN_SPLIT_PX = 220
const MIN_SPLIT_STACKED_PX = 120

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (raw > 0) return raw
  } catch {
    // storage disabled
  }
  return Math.round(window.innerWidth * 0.4)
}

export interface TerminalDockProps {
  sessions: AgentSession[]
  activeId: string | null
  appearance: 'light' | 'dark'
  fontSize: number
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  /** Across the bottom of the window, or a resizable column on the right. */
  position: DockPosition
  onPositionChange: (position: DockPosition) => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onStatus: (session: AgentSession) => void
  /** Scrolls the board to the row a session was launched from. */
  onShowItem: (itemId: string) => void
  /** A companion shell opened or closed; the session list needs re-reading. */
  onSessionsChanged: () => void
}

export function TerminalDock({
  sessions,
  activeId,
  appearance,
  fontSize,
  collapsed,
  onCollapsedChange,
  position,
  onPositionChange,
  onSelect,
  onClose,
  onStatus,
  onShowItem,
  onSessionsChanged,
}: TerminalDockProps) {
  const right = position === 'right'
  const [height, setHeight] = useState(halfWindow)
  const [width, setWidth] = useState(loadWidth)
  /**
   * Size of the agent pane when a companion shell is open, in px: its width
   * side by side at the bottom, its height stacked in the right-hand column.
   */
  const [splitSize, setSplitSize] = useState<number | null>(null)
  /** Which tab's actions menu is open, so a right-click can open it too. */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const dragging = useRef<'height' | 'width' | 'split' | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const seen = useRef(new Set<string>())
  const toast = useToast()

  const clampHeight = useCallback(
    (value: number) =>
      Math.max(MIN_HEIGHT, Math.min(value, window.innerHeight - MIN_LISTS_VISIBLE)),
    [],
  )
  const clampWidth = useCallback(
    (value: number) =>
      Math.max(MIN_WIDTH, Math.min(value, window.innerWidth - MIN_BOARD_VISIBLE)),
    [],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (dragging.current === 'height') {
        // Dock is anchored to the bottom, so height grows as the pointer rises.
        setHeight(clampHeight(window.innerHeight - event.clientY))
      } else if (dragging.current === 'width') {
        // Anchored to the right edge, so width grows as the pointer moves left.
        setWidth(clampWidth(window.innerWidth - event.clientX))
      } else if (dragging.current === 'split' && body.current) {
        const box = body.current.getBoundingClientRect()
        if (right) {
          const next = event.clientY - box.top
          setSplitSize(
            Math.max(MIN_SPLIT_STACKED_PX, Math.min(next, box.height - MIN_SPLIT_STACKED_PX)),
          )
        } else {
          const next = event.clientX - box.left
          setSplitSize(Math.max(MIN_SPLIT_PX, Math.min(next, box.width - MIN_SPLIT_PX)))
        }
      }
    },
    [clampHeight, clampWidth, right],
  )

  useEffect(() => {
    const stop = () => {
      if (dragging.current === 'width') {
        try {
          localStorage.setItem(WIDTH_KEY, String(widthRef.current))
        } catch {
          // storage disabled
        }
      }
      dragging.current = null
      document.body.style.userSelect = ''
    }
    // A smaller window must not leave the dock bigger than the screen.
    const onResize = () => {
      setHeight((current) => clampHeight(current))
      setWidth((current) => clampWidth(current))
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('resize', onResize)
    }
  }, [onPointerMove, clampHeight, clampWidth])

  // Read by the pointerup handler, which is bound once per drag setup.
  const widthRef = useRef(width)
  widthRef.current = width

  // The split's axis flips with the dock, so a size from the other axis is meaningless.
  useEffect(() => setSplitSize(null), [position])

  // A freshly launched session opens the dock, whatever it was doing before,
  // so you can see the agent working straight away. At the bottom that means
  // half the window; a right-hand column keeps the width you gave it.
  const ids = sessions.map((s) => s.id).join(',')
  useEffect(() => {
    const fresh = sessions.filter((s) => !seen.current.has(s.id))
    for (const s of sessions) seen.current.add(s.id)
    if (fresh.length === 0) return
    onCollapsedChange(false)
    setHeight(clampHeight(halfWindow()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, clampHeight])

  if (sessions.length === 0) return null

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]
  const terminalId = active?.terminalId ?? null

  const toggleTerminal = async (session: AgentSession) => {
    try {
      if (session.terminalId) await api.closeTerminal(session.id)
      else await api.openTerminal(session.id)
      onSessionsChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const positionButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onPositionChange(right ? 'bottom' : 'right')}
        >
          {right ? <PanelBottom /> : <PanelRight />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{right ? 'Dock terminal at the bottom' : 'Dock terminal on the right'}</TooltipContent>
    </Tooltip>
  )

  const collapseButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={() => onCollapsedChange(!collapsed)}>
          {right ? (
            collapsed ? <ChevronLeft /> : <ChevronRight />
          ) : collapsed ? (
            <ChevronUp />
          ) : (
            <ChevronDown />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{collapsed ? 'Expand terminal' : 'Collapse terminal'}</TooltipContent>
    </Tooltip>
  )

  // Collapsed on the right: a thin rail rather than a column-wide tab strip.
  if (right && collapsed) {
    return (
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-1 overflow-y-auto border-l bg-card px-1 py-2">
        {collapseButton}
        {positionButton}
        {sessions.map((session) => {
          const look = sessionLook(session)
          return (
            <Tooltip key={session.id}>
              <TooltipTrigger asChild>
                <Badge
                  className={cn(
                    'cursor-pointer',
                    CHIP_SOLID[look.tone],
                    look.waiting && 'animate-session-wait',
                    session.id === active?.id && 'ring-2 ring-ring/50',
                  )}
                  onClick={() => {
                    onSelect(session.id)
                    onCollapsedChange(false)
                  }}
                >
                  {session.agent.slice(0, 2)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="left">
                {session.title} - {look.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  const paneSize = right ? width : height

  return (
    <div
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col bg-card',
        right ? 'min-w-0 border-l' : 'border-t',
      )}
      style={right ? { width } : { height: collapsed ? undefined : height }}
    >
      {right ? (
        <div
          className="absolute inset-y-0 -left-[3px] z-10 w-[5px] cursor-ew-resize"
          onPointerDown={() => {
            dragging.current = 'width'
            document.body.style.userSelect = 'none'
          }}
        />
      ) : (
        <div
          className="-mt-[3px] h-[5px] shrink-0 cursor-ns-resize"
          onPointerDown={() => {
            if (collapsed) return
            dragging.current = 'height'
            document.body.style.userSelect = 'none'
          }}
        />
      )}

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1">
        {sessions.map((session) => {
          const look = sessionLook(session)
          return (
            <div
              key={session.id}
              className={cn(
                'flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5',
                session.id === active?.id ? 'bg-accent' : 'hover:bg-secondary',
              )}
              onClick={() => onSelect(session.id)}
              // Right-click reaches the same menu as the caret, since a tab is
              // the kind of thing people expect to right-click. The menu is
              // controlled rather than triggered by a synthetic click: Radix
              // opens on pointerdown, which dispatching `click` never fires.
              onContextMenu={(event) => {
                event.preventDefault()
                onSelect(session.id)
                setMenuFor(session.id)
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    className={cn(
                      CHIP_SOLID[look.tone],
                      look.waiting && 'animate-session-wait',
                    )}
                  >
                    {session.agent}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{look.label}</TooltipContent>
              </Tooltip>
              <span className="text-xs">{session.title}</span>

              <DropdownMenu
                open={menuFor === session.id}
                onOpenChange={(open) => setMenuFor(open ? session.id : null)}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for ${session.title}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => onShowItem(session.itemId)}>
                    <Crosshair />
                    Show {session.kind === 'issue' ? 'issue' : 'PR'} #{session.itemNumber}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!session.worktreePath}
                    onSelect={() => void toggleTerminal(session)}
                  >
                    <SquareTerminal />
                    {session.terminalId ? 'Close terminal' : 'Open terminal'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      onClose(session.id)
                    }}
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>End session</TooltipContent>
              </Tooltip>
            </div>
          )
        })}

        <div className="flex-1" />

        {active?.note ? (
          <span className="max-w-80 truncate text-xs text-muted-foreground">{active.note}</span>
        ) : null}
        {active?.worktreePath ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="max-w-80 truncate text-xs text-muted-foreground">
                {active.branch}
              </span>
            </TooltipTrigger>
            <TooltipContent>{active.worktreePath}</TooltipContent>
          </Tooltip>
        ) : null}

        {positionButton}
        {collapseButton}
      </div>

      {!collapsed && active ? (
        // Side by side across the bottom; stacked in the narrower right column.
        <div ref={body} className={cn('flex min-h-0 flex-1', right && 'flex-col')}>
          <div
            className="flex min-h-0 min-w-0 flex-col"
            style={
              terminalId
                ? { [right ? 'height' : 'width']: splitSize ?? '50%', flex: '0 0 auto' }
                : { flex: '1 1 0' }
            }
          >
            <TerminalPane
              key={active.id}
              session={active}
              appearance={appearance}
              // The pane refits when these change; a drag or a window resize
              // would otherwise only reach it through ResizeObserver.
              height={paneSize}
              width={terminalId ? (splitSize ?? 0) : 0}
              fontSize={fontSize}
              onStatus={onStatus}
            />
          </div>

          {terminalId ? (
            <>
              <div
                className={cn(
                  'shrink-0',
                  right ? 'h-[5px] cursor-ns-resize border-t' : 'w-[5px] cursor-ew-resize border-l',
                )}
                onPointerDown={() => {
                  dragging.current = 'split'
                  document.body.style.userSelect = 'none'
                }}
              />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <TerminalPane
                  key={terminalId}
                  session={{ ...active, id: terminalId }}
                  appearance={appearance}
                  height={paneSize}
                  width={splitSize ?? 0}
                  fontSize={fontSize}
                  // The shell is a companion, not a session of its own: its
                  // status must not overwrite the agent's in the dock's list.
                  onStatus={() => {}}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
