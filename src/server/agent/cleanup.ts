import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { GraphqlResponseError } from '@octokit/graphql'
import { execa } from 'execa'
import type { DashboardData } from '../../shared/types.js'
import { loadConfig } from '../config.js'
import { getGraphqlClient } from '../github/client.js'
import {
  type ItemState,
  type LifecycleFacts,
  describeFinished,
  lifecycleBlocker,
  workingCopyBlocker,
} from './eligibility.js'

/**
 * Removes the worktrees shazam made for pull requests and issues that are
 * finished. Every Shazam leaves a full checkout under `~/.shazam/worktrees`,
 * often with a `node_modules` or a build in it, and nothing else ever deletes
 * one - so they pile up into gigabytes.
 */

/** One worktree shazam made, as git and its directory name describe it. */
export interface CleanupTarget {
  path: string
  /** The bare mirror the worktree belongs to. */
  mirror: string
  /** "owner/name" */
  repo: string
  kind: 'pull_request' | 'issue'
  number: number
  /** Null on a detached HEAD. */
  branch: string | null
  head: string | null
}

export type CleanupAction = 'removed' | 'would-remove' | 'skipped' | 'failed'

export interface CleanupEntry {
  path: string
  repo: string
  kind: CleanupTarget['kind']
  number: number
  action: CleanupAction
  reason: string
  /** Disk use before removal, for removed and would-remove entries. */
  sizeKb?: number
}

export interface CleanupReport {
  dryRun: boolean
  graceHours: number
  startedAt: string
  finishedAt: string
  entries: CleanupEntry[]
  /** Sum of `sizeKb` over removed (or, in a dry run, would-remove) entries. */
  freedKb: number
}

/** What GitHub knows about one target, keyed by `targetKey`. */
export interface TargetState {
  state: ItemState
  openPullRequestOnBranch: boolean
  /**
   * Pull requests whose head refs can prove the worktree's commits were
   * pushed: the PR itself, or the one that closed an issue.
   */
  relatedPullRequests: number[]
}

export type StateSource = (targets: CleanupTarget[]) => Promise<Map<string, TargetState>>

/** Worktrees and repositories that live sessions are using right now. */
export interface BusyWorktrees {
  paths: Set<string>
  /** "owner/name" of any repository with a session still preparing its worktree. */
  preparingRepos: Set<string>
}

export interface SweepOptions {
  mirrorsDir: string
  worktreesDir: string
  dryRun: boolean
  graceHours: number
  resolveStates: StateSource
  busy: () => BusyWorktrees
  log: (line: string) => void
  now?: () => number
}

export const targetKey = (t: Pick<CleanupTarget, 'repo' | 'kind' | 'number'>) =>
  `${t.repo.toLowerCase()}#${t.kind === 'issue' ? 'issue' : 'pr'}${t.number}`

const git = (cwd: string, args: string[]) => execa('git', args, { cwd, timeout: 300_000 })

/** Resolve symlinks (macOS's /tmp, for one) so paths from git and from us compare. */
export function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Every worktree of every mirror whose directory is one shazam named:
 * `<worktreesDir>/<owner>-<repo>-pr<n>` or `-issue<n>`. Worktrees made by hand
 * from a mirror, or living anywhere else, are never touched.
 */
export async function discoverTargets(
  mirrorsDir: string,
  worktreesDir: string,
): Promise<CleanupTarget[]> {
  if (!existsSync(mirrorsDir)) return []
  const root = canonical(worktreesDir)
  const targets: CleanupTarget[] = []

  for (const owner of readdirSync(mirrorsDir)) {
    const ownerDir = join(mirrorsDir, owner)
    let repos: string[]
    try {
      repos = readdirSync(ownerDir).filter((n) => n.endsWith('.git'))
    } catch {
      continue
    }

    for (const repoDir of repos) {
      const mirror = join(ownerDir, repoDir)
      const name = repoDir.slice(0, -'.git'.length)
      let stdout: string
      try {
        stdout = (await git(mirror, ['worktree', 'list', '--porcelain'])).stdout
      } catch {
        continue
      }

      const pattern = new RegExp(`^${escapeRegExp(`${owner}-${name}-`)}(pr|issue)(\\d+)$`)
      for (const record of stdout.split(/\n\s*\n/)) {
        const lines = record.split('\n')
        const field = (key: string) =>
          lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? null
        const path = field('worktree')
        if (!path || lines.includes('bare')) continue
        if (canonical(dirname(path)) !== root) continue
        const match = basename(path).match(pattern)
        if (!match) continue

        const ref = field('branch')
        targets.push({
          path,
          mirror,
          repo: `${owner}/${name}`,
          kind: match[1] === 'pr' ? 'pull_request' : 'issue',
          number: Number(match[2]),
          branch: ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null,
          head: field('HEAD'),
        })
      }
    }
  }
  return targets
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when some remote-tracking ref (a branch, or a fetched PR head) contains `sha`. */
async function onRemote(mirror: string, sha: string): Promise<boolean> {
  try {
    const { stdout } = await git(mirror, [
      'for-each-ref',
      '--contains',
      sha,
      '--count=1',
      '--format=%(refname)',
      'refs/remotes/',
    ])
    return stdout.trim() !== ''
  } catch {
    return false
  }
}

/**
 * Whether HEAD's commits exist upstream. Ancestry against the base branch is
 * no use - a squash merge leaves the PR's commits out of it - so this asks
 * whether HEAD itself is inside a remote ref: the PR's own head ref, which
 * GitHub keeps after a merge and after the branch is deleted, or any branch.
 * Refs already in the mirror are tried first; a fetch happens only when they
 * do not settle it.
 */
async function headOnRemote(
  target: CleanupTarget,
  related: number[],
  fetched: Set<string>,
): Promise<boolean> {
  if (!target.head) return false
  if (await onRemote(target.mirror, target.head)) return true

  if (!fetched.has(target.mirror)) {
    fetched.add(target.mirror)
    // The same refspec ensureMirror sets, so this cannot drop anything a
    // worktree depends on.
    await git(target.mirror, ['fetch', 'origin', '--prune', '--quiet']).catch(() => {})
  }
  for (const n of related) {
    await git(target.mirror, [
      'fetch',
      'origin',
      '--quiet',
      `+refs/pull/${n}/head:refs/remotes/origin/pr/${n}`,
    ]).catch(() => {})
  }
  return onRemote(target.mirror, target.head)
}

async function status(path: string): Promise<string[] | null> {
  try {
    const { stdout } = await git(path, ['status', '--porcelain'])
    return stdout.split('\n').filter((l) => l.trim() !== '')
  } catch {
    return null
  }
}

async function diskUsageKb(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execa('du', ['-sk', path], { timeout: 120_000 })
    const kb = Number.parseInt(stdout.split(/\s+/)[0] ?? '', 10)
    return Number.isFinite(kb) ? kb : undefined
  } catch {
    return undefined
  }
}

async function remove(target: CleanupTarget): Promise<void> {
  // --force: the checks above already decided that what is left - ignored
  // build output and caches - is disposable. A locked worktree still refuses,
  // which is the point of locking one.
  await git(target.mirror, ['worktree', 'remove', '--force', target.path])
  await git(target.mirror, ['worktree', 'prune']).catch(() => {})

  // The local branch goes only when its tip is safe upstream; an issue branch
  // in particular is reused by the next Shazam on that issue if it survives.
  if (target.branch) {
    const tip = await git(target.mirror, ['rev-parse', '--verify', '--quiet', `refs/heads/${target.branch}`])
      .then((r) => r.stdout.trim())
      .catch(() => '')
    if (tip && (await onRemote(target.mirror, tip))) {
      await git(target.mirror, ['branch', '-D', target.branch]).catch(() => {})
    }
  }
  if (target.kind === 'pull_request') {
    await git(target.mirror, ['update-ref', '-d', `refs/remotes/origin/pr/${target.number}`]).catch(
      () => {},
    )
  }
}

/** One pass over every shazam worktree. Never throws for a single worktree. */
export async function sweepWorktrees(options: SweepOptions): Promise<CleanupReport> {
  const now = options.now ?? Date.now
  const startedAt = new Date(now()).toISOString()
  const entries: CleanupEntry[] = []
  const targets = await discoverTargets(options.mirrorsDir, options.worktreesDir)

  let states = new Map<string, TargetState>()
  if (targets.length > 0) {
    try {
      states = await options.resolveStates(targets)
    } catch (err) {
      options.log(`could not read PR and issue states: ${(err as Error).message}`)
    }
  }

  const fetched = new Set<string>()
  const record = (target: CleanupTarget, action: CleanupAction, reason: string, sizeKb?: number) =>
    entries.push({
      path: target.path,
      repo: target.repo,
      kind: target.kind,
      number: target.number,
      action,
      reason,
      ...(sizeKb === undefined ? {} : { sizeKb }),
    })

  for (const target of targets) {
    const known = states.get(targetKey(target))
    const busy = isBusy(target, options.busy())
    const lifecycle: LifecycleFacts = {
      state: known?.state ?? { kind: 'unknown', reason: 'no answer from GitHub' },
      activeSession: busy,
      openPullRequestOnBranch: known?.openPullRequestOnBranch ?? false,
    }

    const lifecycleReason = lifecycleBlocker(lifecycle, now(), options.graceHours)
    if (lifecycleReason) {
      record(target, 'skipped', lifecycleReason)
      continue
    }

    const lines = await status(target.path)
    if (lines === null) {
      record(target, 'skipped', 'git status failed')
      continue
    }
    const pushed = await headOnRemote(target, known?.relatedPullRequests ?? [], fetched)
    const copyReason = workingCopyBlocker({ status: lines, headOnRemote: pushed })
    if (copyReason) {
      record(target, 'skipped', copyReason)
      continue
    }

    const reason = describeFinished(lifecycle.state, now())
    const sizeKb = await diskUsageKb(target.path)
    if (options.dryRun) {
      record(target, 'would-remove', reason, sizeKb)
      continue
    }

    // A session may have started while git was busy above.
    if (isBusy(target, options.busy())) {
      record(target, 'skipped', 'a session is using it')
      continue
    }
    try {
      await remove(target)
      record(target, 'removed', reason, sizeKb)
    } catch (err) {
      record(target, 'failed', firstLine((err as Error).message))
    }
  }

  const freedKb = entries
    .filter((e) => e.action === 'removed' || e.action === 'would-remove')
    .reduce((sum, e) => sum + (e.sizeKb ?? 0), 0)

  return {
    dryRun: options.dryRun,
    graceHours: options.graceHours,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    entries,
    freedKb,
  }
}

function isBusy(target: CleanupTarget, busy: BusyWorktrees): boolean {
  if (busy.paths.has(canonical(target.path))) return true
  // Its worktree path is not known until it is made, and it may be this one.
  return busy.preparingRepos.has(target.repo.toLowerCase())
}

function firstLine(message: string): string {
  return message.split('\n').find((l) => l.trim() !== '')?.trim() ?? message
}

/**
 * Board rows answer for free whatever the last poll already saw: an open PR or
 * issue, or a recent merge. The rest - closed PRs, older merges, issues - go
 * to GitHub in one aliased GraphQL request per batch.
 */
export function githubStateSource(snapshot: () => DashboardData | null): StateSource {
  return async (targets) => {
    const states = new Map<string, TargetState>()
    const board = snapshot()
    const pending: CleanupTarget[] = []

    const seen = new Map<string, TargetState>()
    if (board) {
      const open: TargetState = {
        state: { kind: 'open' },
        openPullRequestOnBranch: false,
        relatedPullRequests: [],
      }
      const { columns } = board
      for (const pr of [...columns.myPullRequests, ...columns.reviewRequests, ...columns.approvedPrs]) {
        seen.set(targetKey({ repo: pr.repo.nameWithOwner, kind: 'pull_request', number: pr.number }), open)
      }
      for (const issue of [...columns.myIssues, ...columns.assignedIssues]) {
        seen.set(targetKey({ repo: issue.repo.nameWithOwner, kind: 'issue', number: issue.number }), open)
      }
      for (const pr of columns.recentlyMerged) {
        seen.set(targetKey({ repo: pr.repo.nameWithOwner, kind: 'pull_request', number: pr.number }), {
          state: { kind: 'merged', at: pr.mergedAt ?? null },
          openPullRequestOnBranch: false,
          relatedPullRequests: [pr.number],
        })
      }
    }

    for (const target of targets) {
      const hit = seen.get(targetKey(target))
      // An issue's branch can carry an open PR the board does not tie to it,
      // so only an open issue is settled by the board alone.
      if (hit && (target.kind === 'pull_request' || hit.state.kind === 'open')) {
        states.set(targetKey(target), hit)
      } else {
        pending.push(target)
      }
    }

    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH)
      for (const [key, state] of await queryStates(batch)) states.set(key, state)
    }
    return states
  }
}

const BATCH = 40

interface RawItem {
  __typename: 'PullRequest' | 'Issue'
  prState?: 'OPEN' | 'CLOSED' | 'MERGED'
  issueState?: 'OPEN' | 'CLOSED'
  mergedAt?: string | null
  closedAt?: string | null
  timelineItems?: { nodes: ({ closer?: { __typename: string; number?: number } | null } | null)[] }
}

interface RawRepo {
  item: RawItem | null
  branchPrs?: { totalCount: number }
}

/** Exported for tests: builds the aliased query for one batch. */
export function buildStateQuery(batch: CleanupTarget[]): string {
  const parts = batch.map((t, i) => {
    const [owner = '', name = ''] = t.repo.split('/')
    const branchPrs =
      t.kind === 'issue' && t.branch
        ? `branchPrs: pullRequests(headRefName: ${JSON.stringify(t.branch)}, states: [OPEN], first: 1) { totalCount }`
        : ''
    return `t${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      item: issueOrPullRequest(number: ${t.number}) {
        __typename
        ... on PullRequest { prState: state mergedAt closedAt }
        ... on Issue {
          issueState: state
          closedAt
          timelineItems(itemTypes: [CLOSED_EVENT], last: 1) {
            nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number } } } }
          }
        }
      }
      ${branchPrs}
    }`
  })
  return `query {\n${parts.join('\n')}\n}`
}

async function queryStates(batch: CleanupTarget[]): Promise<Map<string, TargetState>> {
  const client = await getGraphqlClient()
  let data: Record<string, RawRepo | null>
  try {
    data = await client<Record<string, RawRepo | null>>(buildStateQuery(batch))
  } catch (err) {
    // One deleted or unreadable repository errors its alias, not the rest.
    if (err instanceof GraphqlResponseError && err.data) {
      data = err.data as Record<string, RawRepo | null>
    } else {
      throw err
    }
  }

  const states = new Map<string, TargetState>()
  batch.forEach((target, i) => {
    states.set(targetKey(target), toTargetState(target, data[`t${i}`] ?? null))
  })
  return states
}

/** Exported for tests: maps one aliased answer onto what the rules need. */
export function toTargetState(target: CleanupTarget, raw: RawRepo | null): TargetState {
  const item = raw?.item
  if (!item) {
    return {
      state: { kind: 'unknown', reason: 'not found, or not readable with this token' },
      openPullRequestOnBranch: false,
      relatedPullRequests: [],
    }
  }
  const openPullRequestOnBranch = (raw?.branchPrs?.totalCount ?? 0) > 0

  if (item.__typename === 'PullRequest') {
    const state: ItemState =
      item.prState === 'MERGED'
        ? { kind: 'merged', at: item.mergedAt ?? null }
        : item.prState === 'CLOSED'
          ? { kind: 'closed', at: item.closedAt ?? null }
          : { kind: 'open' }
    return { state, openPullRequestOnBranch, relatedPullRequests: [target.number] }
  }

  const closer = item.timelineItems?.nodes.at(-1)?.closer
  const related = closer?.__typename === 'PullRequest' && closer.number ? [closer.number] : []
  const state: ItemState =
    item.issueState === 'CLOSED' ? { kind: 'closed', at: item.closedAt ?? null } : { kind: 'open' }
  return { state, openPullRequestOnBranch, relatedPullRequests: related }
}

/** How often an automatic sweep may run; the poll that triggers it is every minute. */
export const SWEEP_EVERY_MS = 15 * 60 * 1000

/**
 * Runs sweeps for the server: one shortly after start (on the first poll), then
 * at most every SWEEP_EVERY_MS, piggybacking on the poller so the board rows it
 * just fetched answer most state questions without another GitHub call.
 */
export class WorktreeJanitor {
  private running: Promise<CleanupReport> | null = null
  private lastSweepAt = 0
  /** Last skip reason logged per path, so a minute-by-minute log stays readable. */
  private readonly lastSkip = new Map<string, string>()

  constructor(
    private readonly deps: {
      busy: () => BusyWorktrees
      snapshot: () => DashboardData | null
      resolveStates?: StateSource
      log?: (line: string) => void
    },
  ) {}

  /** Called after each poll. Does nothing when disabled or swept recently. */
  maybeSweep(): void {
    const config = loadConfig()
    if (!config.autoCleanupWorktrees) return
    if (this.running || Date.now() - this.lastSweepAt < SWEEP_EVERY_MS) return
    void this.sweep({ dryRun: false, automatic: true }).catch((err) =>
      this.log(`sweep failed: ${(err as Error).message}`),
    )
  }

  async sweep(options: {
    dryRun: boolean
    graceHours?: number
    automatic?: boolean
  }): Promise<CleanupReport> {
    // Never two at once: a manual prune during an automatic one waits for it.
    while (this.running) await this.running.catch(() => {})

    const config = loadConfig()
    this.lastSweepAt = Date.now()
    this.running = sweepWorktrees({
      mirrorsDir: config.mirrorsDir,
      worktreesDir: config.worktreesDir,
      dryRun: options.dryRun,
      graceHours: options.graceHours ?? config.worktreeCleanupGraceHours,
      resolveStates: this.deps.resolveStates ?? githubStateSource(this.deps.snapshot),
      busy: this.deps.busy,
      log: (line) => this.log(line),
    })
    try {
      const report = await this.running
      this.logReport(report, options.automatic ?? false)
      return report
    } finally {
      this.running = null
    }
  }

  private logReport(report: CleanupReport, automatic: boolean): void {
    const live = new Set<string>()
    for (const e of report.entries) {
      live.add(e.path)
      const what = `${e.repo}#${e.number} (${e.path})`
      if (e.action === 'skipped') {
        // Automatic sweeps repeat every few minutes; say a skip once per reason.
        if (automatic && this.lastSkip.get(e.path) === e.reason) continue
        this.lastSkip.set(e.path, e.reason)
        this.log(`kept ${what}: ${e.reason}`)
      } else if (e.action === 'failed') {
        this.log(`could not remove ${what}: ${e.reason}`)
      } else {
        this.lastSkip.delete(e.path)
        const verb = e.action === 'removed' ? 'removed' : 'would remove'
        this.log(`${verb} ${what}: ${e.reason}${e.sizeKb ? `, ${formatKb(e.sizeKb)}` : ''}`)
      }
    }
    for (const path of this.lastSkip.keys()) if (!live.has(path)) this.lastSkip.delete(path)

    const acted = report.entries.filter((e) => e.action === 'removed' || e.action === 'would-remove')
    if (acted.length > 0 || !automatic) {
      this.log(
        `${report.dryRun ? 'dry run: ' : ''}${acted.length} of ${report.entries.length} worktrees ${
          report.dryRun ? 'would be' : 'were'
        } removed, ${formatKb(report.freedKb)} ${report.dryRun ? 'reclaimable' : 'freed'}`,
      )
    }
  }

  private log(line: string): void {
    ;(this.deps.log ?? ((l: string) => console.log(l)))(`shazam: worktree cleanup: ${line}`)
  }
}

export function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}
