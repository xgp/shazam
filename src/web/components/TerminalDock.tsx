import { ChevronDown, ChevronUp, Crosshair, MoreVertical, SquareTerminal, X } from 'lucide-react'
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

const MIN_HEIGHT = 140
/** Leave at least this much of the lists visible above the dock. */
const MIN_LISTS_VISIBLE = 160

/** A new session opens the dock across the bottom half of the window. */
const halfWindow = () => Math.round(window.innerHeight / 2)

/** Narrowest either half of a split may be dragged. */
const MIN_SPLIT_PX = 220

export interface TerminalDockProps {
  sessions: AgentSession[]
  activeId: string | null
  appearance: 'light' | 'dark'
  fontSize: number
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
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
  onSelect,
  onClose,
  onStatus,
  onShowItem,
  onSessionsChanged,
}: TerminalDockProps) {
  const [height, setHeight] = useState(halfWindow)
  /** Width of the agent half when a companion shell is open, in px. */
  const [splitWidth, setSplitWidth] = useState<number | null>(null)
  /** Which tab's actions menu is open, so a right-click can open it too. */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const dragging = useRef<'height' | 'split' | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const seen = useRef(new Set<string>())
  const toast = useToast()

  const clamp = useCallback(
    (value: number) =>
      Math.max(MIN_HEIGHT, Math.min(value, window.innerHeight - MIN_LISTS_VISIBLE)),
    [],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (dragging.current === 'height') {
        // Dock is anchored to the bottom, so height grows as the pointer rises.
        setHeight(clamp(window.innerHeight - event.clientY))
      } else if (dragging.current === 'split' && body.current) {
        const box = body.current.getBoundingClientRect()
        const next = event.clientX - box.left
        setSplitWidth(Math.max(MIN_SPLIT_PX, Math.min(next, box.width - MIN_SPLIT_PX)))
      }
    },
    [clamp],
  )

  useEffect(() => {
    const stop = () => {
      dragging.current = null
      document.body.style.userSelect = ''
    }
    // A shorter window must not leave the dock taller than the screen.
    const onResize = () => setHeight((current) => clamp(current))

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('resize', onResize)
    }
  }, [onPointerMove, clamp])

  // A freshly launched session opens the dock to half the window, whatever the
  // dock was doing before, so you can see the agent working straight away.
  const ids = sessions.map((s) => s.id).join(',')
  useEffect(() => {
    const fresh = sessions.filter((s) => !seen.current.has(s.id))
    for (const s of sessions) seen.current.add(s.id)
    if (fresh.length === 0) return
    onCollapsedChange(false)
    setHeight(clamp(halfWindow()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, clamp])

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

  return (
    <div
      className="flex min-h-0 shrink-0 flex-col border-t bg-card"
      style={{ height: collapsed ? undefined : height }}
    >
      <div
        className="-mt-[3px] h-[5px] shrink-0 cursor-ns-resize"
        onPointerDown={() => {
          if (collapsed) return
          dragging.current = 'height'
          document.body.style.userSelect = 'none'
        }}
      />

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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => onCollapsedChange(!collapsed)}>
              {collapsed ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{collapsed ? 'Expand terminal' : 'Collapse terminal'}</TooltipContent>
        </Tooltip>
      </div>

      {!collapsed && active ? (
        <div ref={body} className="flex min-h-0 flex-1">
          <div
            className="flex min-w-0 flex-col"
            style={terminalId ? { width: splitWidth ?? '50%', flex: '0 0 auto' } : { flex: '1 1 0' }}
          >
            <TerminalPane
              key={active.id}
              session={active}
              appearance={appearance}
              // The pane refits when these change; a drag or a window resize
              // would otherwise only reach it through ResizeObserver.
              height={height}
              width={terminalId ? (splitWidth ?? 0) : 0}
              fontSize={fontSize}
              onStatus={onStatus}
            />
          </div>

          {terminalId ? (
            <>
              <div
                className="w-[5px] shrink-0 cursor-ew-resize border-l"
                onPointerDown={() => {
                  dragging.current = 'split'
                  document.body.style.userSelect = 'none'
                }}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <TerminalPane
                  key={terminalId}
                  session={{ ...active, id: terminalId }}
                  appearance={appearance}
                  height={height}
                  width={splitWidth ?? 0}
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
