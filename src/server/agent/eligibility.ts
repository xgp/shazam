/**
 * The rules for when a shazam worktree can be deleted, kept free of git and
 * GitHub so they can be tested on their own. `cleanup.ts` gathers the facts.
 */

/** What GitHub says about the PR or issue a worktree was made for. */
export type ItemState =
  | { kind: 'open' }
  /** `at` is when it merged or closed; null when GitHub did not say. */
  | { kind: 'merged' | 'closed'; at: string | null }
  /** Deleted, transferred, unreadable, or GitHub did not answer. */
  | { kind: 'unknown'; reason: string }

export interface LifecycleFacts {
  state: ItemState
  /** A session (agent or shell) is running, or being prepared, in it. */
  activeSession: boolean
  /**
   * An open pull request is still on this worktree's branch. Matters for issue
   * worktrees: the issue can be closed while the PR made from it is open.
   */
  openPullRequestOnBranch: boolean
}

export interface WorkingCopyFacts {
  /** `git status --porcelain` lines, before disposable entries are dropped. */
  status: string[]
  /** HEAD is reachable from a remote-tracking ref (branch or PR head). */
  headOnRemote: boolean
}

/**
 * Untracked paths that are rebuilt on demand and never anyone's work. Matched
 * against every path segment, so `web/node_modules/` counts as well as
 * `node_modules/`. Anything else untracked keeps the worktree: an agent that
 * wrote a new file and never committed it has done work nobody else has.
 */
const DISPOSABLE_SEGMENTS = new Set([
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
  '.gradle',
  'target',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'coverage',
  '.nyc_output',
  'test-results',
  'playwright-report',
  '.DS_Store',
])

/** Whole untracked paths that are per-machine agent state, not work. */
const DISPOSABLE_PATHS = new Set(['.claude/settings.local.json'])

const DISPOSABLE_SUFFIXES = ['.pyc', '.pyo', '.log', '.tsbuildinfo']

/** porcelain v1: `XY path`, with `?? path` for untracked and a trailing / for a directory. */
export function isDisposable(line: string): boolean {
  if (!line.startsWith('?? ')) return false
  let path = line.slice(3).trim()
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  const bare = path.replace(/\/$/, '')
  if (DISPOSABLE_PATHS.has(bare)) return true
  if (DISPOSABLE_SUFFIXES.some((s) => bare.endsWith(s))) return true
  return bare.split('/').some((segment) => DISPOSABLE_SEGMENTS.has(segment))
}

/** The status lines that represent real, unsaved work. */
export function meaningfulChanges(status: string[]): string[] {
  return status.filter((line) => line.trim() !== '' && !isDisposable(line))
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Cheap checks first - no git involved - so a worktree with an open PR never
 * costs a fetch. Returns why the worktree must stay, or null when it may go
 * as far as its PR or issue and sessions are concerned.
 */
export function lifecycleBlocker(
  facts: LifecycleFacts,
  now: number,
  graceHours: number,
): string | null {
  if (facts.activeSession) return 'a session is using it'

  const { state } = facts
  if (state.kind === 'unknown') return `state unknown (${state.reason})`
  if (state.kind === 'open') return 'still open'
  if (facts.openPullRequestOnBranch) return 'an open pull request is on its branch'

  if (graceHours > 0) {
    // No timestamp means we cannot tell how long ago; wait rather than guess.
    if (state.at === null) return `${state.kind}, but GitHub gave no time for it`
    const age = now - Date.parse(state.at)
    if (!(age >= graceHours * HOUR_MS)) {
      const left = Math.max(1, Math.ceil((graceHours * HOUR_MS - age) / HOUR_MS))
      return `${state.kind} ${formatAge(age)} ago; grace period has ${left}h left`
    }
  }
  return null
}

/** Returns why the checkout itself must stay, or null when nothing would be lost. */
export function workingCopyBlocker(facts: WorkingCopyFacts): string | null {
  const changes = meaningfulChanges(facts.status)
  if (changes.length > 0) {
    const sample = changes.slice(0, 3).map((l) => l.trim()).join(', ')
    const more = changes.length > 3 ? ` and ${changes.length - 3} more` : ''
    return `uncommitted changes (${sample}${more})`
  }
  if (!facts.headOnRemote) return 'HEAD has commits not found on any remote ref'
  return null
}

export interface Decision {
  remove: boolean
  reason: string
}

/** Both checks together, as the sweep applies them. */
export function decide(
  lifecycle: LifecycleFacts,
  workingCopy: WorkingCopyFacts,
  now: number,
  graceHours: number,
): Decision {
  const blocker =
    lifecycleBlocker(lifecycle, now, graceHours) ?? workingCopyBlocker(workingCopy)
  if (blocker) return { remove: false, reason: blocker }
  return { remove: true, reason: describeFinished(lifecycle.state, now) }
}

export function describeFinished(state: ItemState, now: number): string {
  if (state.kind !== 'merged' && state.kind !== 'closed') return state.kind
  return state.at ? `${state.kind} ${formatAge(now - Date.parse(state.at))} ago` : state.kind
}

export function formatAge(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS)
  if (hours < 1) return `${Math.max(0, Math.floor(ms / 60_000))}m`
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
