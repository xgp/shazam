import { randomUUID } from 'node:crypto'
import { chmodSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import type { AgentId, AgentSession, PtyServerMessage, ShazamIntent } from '../../shared/types.js'
import { buildPrompt, getAdapter, type LaunchContext } from './adapter.js'
import { loadConfig } from '../config.js'
import { ensureWorktree } from './worktree.js'

/** Replayed to every attaching client, so a page reload does not lose scrollback. */
const BUFFER_LIMIT = 256 * 1024

type Listener = (message: PtyServerMessage) => void

interface Entry {
  session: AgentSession
  pty: IPty | null
  buffer: string[]
  bufferSize: number
  listeners: Set<Listener>
  /** When the process last wrote anything; the basis for `activity`. */
  lastOutputAt: number
  /** Set on a companion shell, naming the agent session it belongs to. */
  companionOf: string | null
  /**
   * Last geometry the browser asked for. The client attaches and reports its
   * size within milliseconds, but cloning and fetching mean the pty is not
   * spawned for seconds, so this is nearly always set before there is a process
   * to apply it to - and it becomes that process's initial size.
   */
  size: { cols: number; rows: number }
}

/** Only used when a client never reported a size before the agent started. */
const DEFAULT_SIZE = { cols: 120, rows: 30 }

/** The slice of a dashboard row a session actually needs. */
export type ShazamItem =
  | {
      kind: 'pull_request'
      /** The dashboard row id, so the board can scroll back to it later. */
      id: string
      url: string
      number: number
      headRef: string
      repo: { nameWithOwner: string }
      headRepo: { nameWithOwner: string; url: string } | null
    }
  | {
      kind: 'issue'
      id: string
      url: string
      number: number
      repo: { nameWithOwner: string }
    }

export interface ShazamRequest {
  item: ShazamItem
  agent: AgentId
  /** Which opening prompt the agent gets. Defaults to reading and waiting. */
  intent: ShazamIntent
}

/**
 * How long a running agent has to stay silent before we call it `waiting`.
 * Long enough that a pause for thought between tool calls does not register,
 * short enough that you notice the pulse soon after it actually stops.
 */
const QUIET_MS = 2_500

/** How often the silence is checked. */
const ACTIVITY_TICK_MS = 1_000

/**
 * node-pty spawns through a small `spawn-helper` binary on POSIX. Its execute
 * bit is set by node-pty's postinstall script, which does not run when npm is
 * configured to skip install scripts - a common hardening default, and the
 * exact case `npx shazam serve` lands in. Without it every spawn dies with a
 * bare "posix_spawnp failed.", so we repair it ourselves.
 */
function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return

  const require = createRequire(import.meta.url)
  let packageDir: string
  try {
    packageDir = dirname(require.resolve('node-pty/package.json'))
  } catch {
    return
  }

  const candidates = [
    join(packageDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    join(packageDir, 'build', 'Release', 'spawn-helper'),
  ]

  for (const helper of candidates) {
    try {
      if ((statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755)
    } catch {
      // absent on this platform, or not ours to chmod
    }
  }
}

/**
 * node-pty is a native module. Importing it lazily means a machine where the
 * prebuild is unavailable still gets a working read-only dashboard, with the
 * failure reported on the session that needed it.
 */
let ptyModule: typeof import('node-pty') | null = null
let ptyError: string | null = null

async function loadPty(): Promise<typeof import('node-pty')> {
  if (ptyModule) return ptyModule
  if (ptyError) throw new Error(ptyError)
  try {
    ensureSpawnHelperExecutable()
    ptyModule = await import('node-pty')
    return ptyModule
  } catch (err) {
    ptyError = `node-pty failed to load (${(err as Error).message}). Terminal sessions are unavailable.`
    throw new Error(ptyError)
  }
}

export class SessionManager {
  private readonly entries = new Map<string, Entry>()
  private activityTimer: NodeJS.Timeout | null = null

  /** Companion shells are reached through their agent session, not listed. */
  list(): AgentSession[] {
    return [...this.entries.values()]
      .filter((e) => e.companionOf === null)
      .map((e) => e.session)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  get(id: string): AgentSession | null {
    return this.entries.get(id)?.session ?? null
  }

  /**
   * Returns as soon as the session record exists. Cloning and fetching can take
   * a while on a cold mirror, so progress streams into the terminal itself.
   */
  create(req: ShazamRequest): AgentSession {
    const { item, agent } = req
    const session: AgentSession = {
      id: randomUUID(),
      agent,
      status: 'preparing',
      activity: null,
      title: `${item.repo.nameWithOwner}#${item.number}`,
      kind: item.kind,
      itemId: item.id,
      itemUrl: item.url,
      itemNumber: item.number,
      repo: item.repo.nameWithOwner,
      // An issue's branch is not known until the worktree is cut from the
      // repository's default branch, which happens below.
      branch: item.kind === 'pull_request' ? item.headRef : '',
      worktreePath: null,
      terminalId: null,
      startedAt: new Date().toISOString(),
      exitCode: null,
      note: 'Preparing worktree',
    }

    const entry: Entry = {
      session,
      pty: null,
      buffer: [],
      bufferSize: 0,
      listeners: new Set(),
      lastOutputAt: Date.now(),
      companionOf: null,
      size: { ...DEFAULT_SIZE },
    }
    this.entries.set(session.id, entry)

    void this.prepareAndSpawn(entry, req)
    this.startActivityWatch()
    return session
  }

  /**
   * A plain login shell in the agent's worktree, so you can run a build or a
   * `git log` beside the agent without interrupting it. It is a session like
   * any other as far as the websocket is concerned - only `list` hides it.
   */
  async openTerminal(id: string): Promise<AgentSession | null> {
    const parent = this.entries.get(id)
    if (!parent || parent.companionOf !== null) return null
    if (!parent.session.worktreePath) throw new Error('The worktree is not ready yet')

    const existing = parent.session.terminalId
      ? this.entries.get(parent.session.terminalId)
      : undefined
    if (existing && existing.session.status === 'running') return existing.session

    const cwd = parent.session.worktreePath
    const session: AgentSession = {
      ...parent.session,
      id: randomUUID(),
      status: 'running',
      activity: 'waiting',
      title: `${parent.session.title} shell`,
      terminalId: null,
      startedAt: new Date().toISOString(),
      exitCode: null,
      note: null,
    }

    const entry: Entry = {
      session,
      pty: null,
      buffer: [],
      bufferSize: 0,
      listeners: new Set(),
      lastOutputAt: Date.now(),
      companionOf: parent.session.id,
      size: { ...DEFAULT_SIZE },
    }
    this.entries.set(session.id, entry)

    const pty = await loadPty()
    const shell = process.env.SHELL || '/bin/bash'
    const child = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: entry.size.cols,
      rows: entry.size.rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<
        string,
        string
      >,
    })

    entry.pty = child
    this.startActivityWatch()
    child.onData((data) => this.emitOutput(entry, data))
    child.onExit(({ exitCode }) => {
      entry.pty = null
      entry.session.status = 'exited'
      entry.session.activity = null
      entry.session.exitCode = exitCode
      this.emitStatus(entry)
      // The tab's split closes with the shell that filled it.
      const owner = this.entries.get(parent.session.id)
      if (owner && owner.session.terminalId === session.id) {
        owner.session.terminalId = null
        this.emitStatus(owner)
      }
    })

    parent.session.terminalId = session.id
    this.emitStatus(parent)
    return session
  }

  closeTerminal(id: string): boolean {
    const parent = this.entries.get(id)
    const terminalId = parent?.session.terminalId
    if (!parent || !terminalId) return false
    this.close(terminalId)
    parent.session.terminalId = null
    this.emitStatus(parent)
    return true
  }

  private async prepareAndSpawn(entry: Entry, req: ShazamRequest): Promise<void> {
    const { item, agent } = req
    const log = (line: string) => this.emitOutput(entry, `\x1b[2m${line}\x1b[0m\r\n`)

    try {
      const { path, branch, gitRoot, reused } = await ensureWorktree(
        item.kind === 'issue'
          ? { kind: 'issue', repo: item.repo.nameWithOwner, issueNumber: item.number }
          : {
              kind: 'pull_request',
              repo: item.repo.nameWithOwner,
              prNumber: item.number,
              headRef: item.headRef,
              headRepo: item.headRepo,
            },
        log,
      )

      entry.session.worktreePath = path
      entry.session.branch = branch
      entry.session.note = reused ? 'Reused existing worktree' : null

      const adapter = getAdapter(agent)
      const launch: LaunchContext = {
        prompt: buildPrompt({
          pr: { url: item.url, number: item.number, repo: item.repo },
          path,
          branch,
          intent: req.intent,
        }),
        cwd: path,
        gitRoot,
        trustWorktrees: loadConfig().trustWorktrees,
      }

      const prepared = adapter.prepare?.(launch)
      if (prepared) log(prepared)

      const spec = adapter.launch(launch)

      log(`Starting ${adapter.label} in ${path}`)

      const pty = await loadPty()
      const child = pty.spawn(spec.command, spec.args, {
        name: 'xterm-256color',
        // Whatever the browser last reported, so the agent's very first paint
        // is already the right width rather than waiting for a window resize.
        cols: entry.size.cols,
        rows: entry.size.rows,
        cwd: path,
        env: {
          ...process.env,
          ...spec.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      })

      entry.pty = child
      entry.session.status = 'running'
      entry.session.activity = 'working'
      entry.lastOutputAt = Date.now()
      // Belt and braces: the watch is started at create() too, but only a
      // spawned process can actually go quiet.
      this.startActivityWatch()
      this.emitStatus(entry)

      child.onData((data) => this.emitOutput(entry, data))
      child.onExit(({ exitCode }) => {
        entry.pty = null
        entry.session.status = 'exited'
        entry.session.activity = null
        entry.session.exitCode = exitCode
        this.emitOutput(entry, `\r\n\x1b[2m[${adapter.label} exited with code ${exitCode}]\x1b[0m\r\n`)
        this.emitStatus(entry)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      entry.session.status = 'failed'
      entry.session.activity = null
      entry.session.note = message
      this.emitOutput(entry, `\r\n\x1b[31m${message}\x1b[0m\r\n`)
      this.emitStatus(entry)
    }
  }

  attach(id: string, listener: Listener): () => void {
    const entry = this.entries.get(id)
    if (!entry) {
      listener({ type: 'error', message: `No such session: ${id}` })
      return () => {}
    }

    entry.listeners.add(listener)
    listener({ type: 'status', session: entry.session })
    if (entry.bufferSize > 0) {
      listener({ type: 'output', data: entry.buffer.join('') })
    }

    return () => entry.listeners.delete(listener)
  }

  write(id: string, data: string): void {
    this.entries.get(id)?.pty?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    // xterm reports 0 while its container is hidden; resizing to 0 kills layout.
    if (!entry || cols <= 0 || rows <= 0) return

    entry.size = { cols, rows }
    // No process yet: the size is remembered and applied when it spawns.
    entry.pty?.resize(cols, rows)
  }

  /** Kills the process if it is still running and forgets the session. */
  close(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    try {
      entry.pty?.kill()
    } catch {
      // already gone
    }
    for (const listener of entry.listeners) {
      listener({ type: 'status', session: { ...entry.session, status: 'exited' } })
    }
    entry.listeners.clear()
    this.entries.delete(id)
    return true
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id)
  }

  private emitOutput(entry: Entry, data: string): void {
    entry.buffer.push(data)
    entry.bufferSize += data.length
    while (entry.bufferSize > BUFFER_LIMIT && entry.buffer.length > 1) {
      entry.bufferSize -= entry.buffer.shift()!.length
    }

    entry.lastOutputAt = Date.now()
    // Anything on the wire means it is working again. The other direction is
    // the watcher's job, since silence has no event to hang off.
    if (entry.session.status === 'running' && entry.session.activity !== 'working') {
      entry.session.activity = 'working'
      this.emitStatus(entry)
    }

    for (const listener of entry.listeners) listener({ type: 'output', data })
  }

  /**
   * Flips a running session to `waiting` once it has been quiet long enough.
   * One timer for every session rather than one each, and it stops itself when
   * nothing is running so an idle shazam holds no interval open.
   */
  private startActivityWatch(): void {
    if (this.activityTimer) return
    this.activityTimer = setInterval(() => {
      const now = Date.now()
      let live = 0

      for (const entry of this.entries.values()) {
        // `preparing` counts as live or a cold clone - which is minutes, not
        // seconds - would stop the watch before its agent ever spawned.
        if (entry.session.status !== 'running' && entry.session.status !== 'preparing') continue
        live += 1
        if (
          entry.session.status === 'running' &&
          entry.session.activity === 'working' &&
          now - entry.lastOutputAt >= QUIET_MS
        ) {
          entry.session.activity = 'waiting'
          this.emitStatus(entry)
        }
      }

      if (live === 0) {
        clearInterval(this.activityTimer!)
        this.activityTimer = null
      }
    }, ACTIVITY_TICK_MS)
    this.activityTimer.unref()
  }

  private emitStatus(entry: Entry): void {
    for (const listener of entry.listeners) {
      listener({ type: 'status', session: entry.session })
    }
  }
}
