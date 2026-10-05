import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type { AgentSession, PtyServerMessage } from '../../shared/types.js'
import { ptyUrl } from '../lib/api.js'

const THEMES = {
  dark: {
    background: '#111113',
    foreground: '#eeeef0',
    cursor: '#eeeef0',
    selectionBackground: '#3a4a6b',
  },
  light: {
    background: '#fcfcfd',
    foreground: '#1c2024',
    cursor: '#1c2024',
    selectionBackground: '#cfd8e8',
  },
} as const

export interface TerminalPaneProps {
  session: AgentSession
  appearance: 'light' | 'dark'
  /** Dock height. Changes are a signal to refit, not a style. */
  height: number
  /** Pane width, for the same reason: dragging the split must refit too. */
  width?: number
  fontSize: number
  onStatus: (session: AgentSession) => void
}

export function TerminalPane({
  session,
  appearance,
  height,
  width,
  fontSize,
  onStatus,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const syncRef = useRef<() => void>(() => {})
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus

  // Re-run only on session change: the socket and terminal outlive theme flips
  // and resizes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize,
      cursorBlink: true,
      convertEol: false,
      scrollback: 10_000,
      theme: THEMES[appearance],
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    // Clicking Shazam should leave you able to type at the agent immediately.
    term.focus()

    const socket = new WebSocket(ptyUrl(session.id))
    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
    }

    const sync = () => {
      try {
        fit.fit()
      } catch {
        return // container has no size yet
      }
      send({ type: 'resize', cols: term.cols, rows: term.rows })
    }
    syncRef.current = sync

    // Coalesce bursts (a drag emits one per pointer move) onto one refit.
    let pending: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = null
        sync()
      }, 16)
    }

    socket.onopen = sync
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as PtyServerMessage
      if (message.type === 'output') term.write(message.data)
      else if (message.type === 'status') statusRef.current(message.session)
      else if (message.type === 'error') term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`)
    }
    socket.onclose = () => term.write('\r\n\x1b[2m[disconnected]\x1b[0m\r\n')

    term.onData((data) => send({ type: 'input', data }))

    const observer = new ResizeObserver(schedule)
    observer.observe(host)

    // A background tab runs no rendering steps, so ResizeObserver never fires
    // there: resize the window with shazam behind another tab and the terminal
    // would stay at its old geometry. Both listeners below cover that.
    window.addEventListener('resize', schedule)
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (pending) clearTimeout(pending)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', onVisible)
      syncRef.current = () => {}
      socket.close()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Theme and font changes repaint in place rather than tearing the session down.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[appearance]
  }, [appearance])

  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.fontSize = fontSize
    syncRef.current()
  }, [fontSize])

  // The dock changed size; refit on the next tick, once layout has settled.
  useEffect(() => {
    const timer = setTimeout(() => syncRef.current(), 0)
    return () => clearTimeout(timer)
  }, [height, width])

  return <div ref={hostRef} className="terminal-host" />
}
