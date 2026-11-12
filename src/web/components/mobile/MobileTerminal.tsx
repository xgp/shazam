import {
  ArrowLeft,
  ChevronDown,
  Crosshair,
  Keyboard,
  Loader2,
  SendHorizontal,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { AgentSession } from '../../../shared/types.js'
import { useVisualViewportHeight } from '../../hooks/useIsMobile.js'
import { api } from '../../lib/api.js'
import { CHIP_SOLID } from '../chips.js'
import { sessionLook } from '../SessionBadge.js'
import { TerminalPane } from '../TerminalPane.js'
import { useToast } from '../Toaster.js'

/** Keys a phone keyboard does not have, and an agent TUI needs. */
const KEYS: { label: string; aria: string; data: string }[] = [
  { label: 'esc', aria: 'Escape', data: '\x1b' },
  { label: 'tab', aria: 'Tab', data: '\t' },
  { label: '⇧tab', aria: 'Shift Tab', data: '\x1b[Z' },
  { label: '^C', aria: 'Control C', data: '\x03' },
  { label: '←', aria: 'Left', data: '\x1b[D' },
  { label: '↑', aria: 'Up', data: '\x1b[A' },
  { label: '↓', aria: 'Down', data: '\x1b[B' },
  { label: '→', aria: 'Right', data: '\x1b[C' },
  { label: '⏎', aria: 'Enter', data: '\r' },
]

/** A phone-sized font: about 45 columns in portrait, 90 in landscape. */
const FONT_SIZE = 12

/** Ctrl+<letter> is the letter's code with the top bits cleared: c -> 0x03. */
function withCtrl(data: string): string {
  if (data.length !== 1) return data
  const code = data.toLowerCase().charCodeAt(0)
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96)
  if (data === '[') return '\x1b'
  if (data === ' ') return '\x00'
  return data
}

export interface MobileTerminalProps {
  sessions: AgentSession[]
  active: AgentSession
  appearance: 'light' | 'dark'
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onBack: () => void
  onStatus: (session: AgentSession) => void
  /** Back to the board, scrolled to the card the session came from. */
  onShowItem: (itemId: string) => void
  /** The companion shell opened or closed; the session list needs re-reading. */
  onSessionsChanged: () => void
}

/**
 * One terminal at a time, full screen. The desktop dock's side-by-side split
 * leaves each half ~25 columns on a phone, so agent and shell become a toggle.
 */
export function MobileTerminal({
  sessions,
  active,
  appearance,
  onSelect,
  onClose,
  onBack,
  onStatus,
  onShowItem,
  onSessionsChanged,
}: MobileTerminalProps) {
  const height = useVisualViewportHeight()
  const toast = useToast()
  const [pane, setPane] = useState<'agent' | 'shell'>('agent')
  const [opening, setOpening] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const sender = useRef<((data: string) => void) | null>(null)
  const look = sessionLook(active)
  const showShell = pane === 'shell' && active.terminalId !== null

  const send = (data: string) => sender.current?.(data)

  const openShell = async () => {
    setPane('shell')
    if (active.terminalId || opening) return
    setOpening(true)
    try {
      await api.openTerminal(active.id)
      onSessionsChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      setPane('agent')
    } finally {
      setOpening(false)
    }
  }

  const closeShell = async () => {
    setPane('agent')
    try {
      await api.closeTerminal(active.id)
      onSessionsChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  /**
   * The compose box exists for what a terminal is bad at on a phone:
   * autocorrect, dictation and paste. The Enter goes separately, a beat later,
   * because an agent TUI treats text and Enter arriving in one write as a
   * paste and leaves it sitting in the prompt.
   */
  const submitDraft = () => {
    if (draft) send(draft)
    setTimeout(() => send('\r'), draft ? 60 : 0)
    setDraft('')
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 flex flex-col bg-card"
      style={{ height }}
      data-mobile-terminal
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b py-1"
        style={{
          paddingLeft: 'max(0.25rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.25rem, env(safe-area-inset-right))',
          paddingTop: 'max(0.25rem, env(safe-area-inset-top))',
        }}
      >
        <Button variant="ghost" size="icon" aria-label="Back to board" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Session menu"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
            >
              <Badge className={cn(CHIP_SOLID[look.tone], look.waiting && 'animate-session-wait')}>
                {active.agent}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{active.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {look.label} · {active.branch}
                </span>
              </span>
              <span className="flex items-center text-xs text-muted-foreground">
                {sessions.length > 1 ? sessions.length : null}
                <ChevronDown className="size-4" />
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[min(20rem,calc(100vw-1rem))]">
            {sessions.map((s) => {
              const l = sessionLook(s)
              return (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => {
                    setPane('agent')
                    onSelect(s.id)
                  }}
                  className={cn('gap-2 py-2', s.id === active.id && 'bg-accent/50')}
                >
                  <Badge className={CHIP_SOLID[l.tone]}>{s.agent}</Badge>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="text-xs text-muted-foreground">{l.label}</span>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onShowItem(active.itemId)}>
              <Crosshair />
              Show {active.kind === 'issue' ? 'issue' : 'PR'} #{active.itemNumber} on the board
            </DropdownMenuItem>
            {active.terminalId ? (
              <DropdownMenuItem onSelect={() => void closeShell()}>
                <SquareTerminal />
                Close shell
              </DropdownMenuItem>
            ) : null}
            {/* In a menu rather than on the bar: next to the back arrow, a
                stray tap would kill the agent. */}
            <DropdownMenuItem variant="destructive" onSelect={() => onClose(active.id)}>
              <X />
              End session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant={composing ? 'secondary' : 'ghost'}
          size="icon"
          aria-label="Compose a message"
          aria-pressed={composing}
          onClick={() => setComposing((c) => !c)}
        >
          <Keyboard />
        </Button>
      </div>

      {/* Agent and its companion shell as a segmented toggle, not a split. */}
      <div className="flex shrink-0 gap-1 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={() => setPane('agent')}
          className={cn(
            'flex h-8 flex-1 items-center justify-center rounded-md text-sm',
            pane === 'agent' ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
          )}
        >
          {active.agent}
        </button>
        <button
          type="button"
          disabled={!active.worktreePath}
          onClick={() => void openShell()}
          className={cn(
            'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm disabled:opacity-50',
            pane === 'shell' ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
          )}
        >
          {opening ? <Loader2 className="size-4 animate-spin" /> : <SquareTerminal className="size-4" />}
          {active.terminalId ? 'shell' : 'open shell'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {pane === 'shell' && !showShell ? (
          <p className="p-4 text-sm text-muted-foreground">Opening a shell in the worktree…</p>
        ) : (
          <TerminalPane
            key={showShell ? active.terminalId! : active.id}
            session={showShell ? { ...active, id: active.terminalId! } : active}
            appearance={appearance}
            height={height}
            fontSize={FONT_SIZE}
            autoFocus={false}
            onStatus={showShell ? () => {} : onStatus}
            onSender={(next) => {
              sender.current = next
            }}
            transformInput={(data) => {
              if (!ctrl) return data
              setCtrl(false)
              return withCtrl(data)
            }}
          />
        )}
      </div>

      {composing ? (
        <form
          className="flex shrink-0 items-center gap-1 border-t px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            submitDraft()
          }}
        >
          {/* text-base: anything under 16px makes iOS zoom the page on focus. */}
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Message ${showShell ? 'the shell' : active.agent}`}
            aria-label="Message to send"
            enterKeyHint="send"
            className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button type="submit" size="icon-lg" aria-label="Send">
            <SendHorizontal />
          </Button>
        </form>
      ) : null}

      {/* The home indicator on notched phones sits over this row. */}
      <div
        className="flex shrink-0 gap-1 border-t px-1 pt-1"
        style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          aria-label="Control (applies to the next key)"
          aria-pressed={ctrl}
          onPointerDown={(event) => {
            event.preventDefault()
            setCtrl((c) => !c)
          }}
          className={cn(
            'h-10 min-w-0 flex-1 rounded-md px-1 font-mono text-xs',
            ctrl ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
          )}
        >
          ctrl
        </button>
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            aria-label={key.aria}
            // pointerdown + preventDefault keeps focus where it is, so tapping
            // a key does not dismiss the soft keyboard.
            onPointerDown={(event) => {
              event.preventDefault()
              send(key.data)
            }}
            // A keyboard activation has no pointerdown (detail is 0).
            onClick={(event) => {
              if (event.detail === 0) send(key.data)
            }}
            className="h-10 min-w-0 flex-1 rounded-md bg-secondary px-1 font-mono text-xs whitespace-nowrap text-secondary-foreground active:bg-accent"
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  )
}
