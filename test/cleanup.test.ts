import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { execa } from 'execa'
import {
  type BusyWorktrees,
  type CleanupReport,
  type CleanupTarget,
  type TargetState,
  buildStateQuery,
  canonical,
  sweepWorktrees,
  targetKey,
  toTargetState,
} from '../src/server/agent/cleanup.js'

/**
 * A real bare "GitHub" repository, a shazam-style mirror of it, and one
 * worktree per case. Only GitHub's answers about PR and issue state are
 * stubbed; every git check runs for real.
 */

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-22T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

let root: string
let origin: string
let mirror: string
let mirrorsDir: string
let worktreesDir: string

const git = async (cwd: string, ...args: string[]) => (await execa('git', args, { cwd })).stdout

const wt = (suffix: string) => join(worktreesDir, `acme-widget-${suffix}`)

/** A worktree on `branch` off main with one commit of its own. */
async function worktreeWithCommit(suffix: string, branch: string): Promise<string> {
  const path = wt(suffix)
  await git(mirror, 'worktree', 'add', '-b', branch, path, 'refs/remotes/origin/main')
  writeFileSync(join(path, `${branch}.txt`), `${branch}\n`)
  await git(path, 'add', '.')
  await git(path, 'commit', '-qm', branch)
  return path
}

/** What GitHub does when a PR is opened: keep its head at refs/pull/<n>/head. */
async function pushAsPullHead(path: string, n: number): Promise<void> {
  await git(path, 'push', '-q', origin, `HEAD:refs/pull/${n}/head`)
}

const merged = (at: string, n: number): TargetState => ({
  state: { kind: 'merged', at },
  openPullRequestOnBranch: false,
  relatedPullRequests: [n],
})

const states = new Map<string, TargetState>()
const pr = (n: number) => targetKey({ repo: 'acme/widget', kind: 'pull_request', number: n })
const issue = (n: number) => targetKey({ repo: 'acme/widget', kind: 'issue', number: n })

let busy: BusyWorktrees = { paths: new Set(), preparingRepos: new Set() }

const sweep = (dryRun: boolean) =>
  sweepWorktrees({
    mirrorsDir,
    worktreesDir,
    dryRun,
    graceHours: 24,
    resolveStates: async () => states,
    busy: () => busy,
    log: () => {},
    now: () => NOW,
  })

const actionFor = (report: CleanupReport, suffix: string) =>
  // By name: a removed worktree's path no longer resolves through symlinks.
  report.entries.find((e) => e.path.endsWith(`/acme-widget-${suffix}`))

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'shazam-cleanup-'))
  // Keep the developer's own git config (signing, hooks) out of it.
  const gitconfig = join(root, 'gitconfig')
  writeFileSync(gitconfig, '[user]\n  name = test\n  email = test@example.com\n[init]\n  defaultBranch = main\n')
  process.env.GIT_CONFIG_GLOBAL = gitconfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  origin = join(root, 'origin.git')
  await git(root, 'init', '-q', '--bare', origin)
  const seed = join(root, 'seed')
  await git(root, 'clone', '-q', origin, seed)
  writeFileSync(join(seed, 'README'), 'hello\n')
  writeFileSync(join(seed, '.gitignore'), 'ignored-build/\n')
  await git(seed, 'add', '.')
  await git(seed, 'commit', '-qm', 'init')
  await git(seed, 'push', '-q', 'origin', 'HEAD:main')

  // The shape ensureMirror leaves behind.
  mirrorsDir = join(root, 'home', 'mirrors')
  worktreesDir = join(root, 'home', 'worktrees')
  mkdirSync(join(mirrorsDir, 'acme'), { recursive: true })
  mkdirSync(worktreesDir, { recursive: true })
  mirror = join(mirrorsDir, 'acme', 'widget.git')
  await git(root, 'clone', '-q', '--bare', origin, mirror)
  await git(mirror, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
  await git(mirror, 'fetch', '-q', 'origin')

  // 1: squash-merged and its branch deleted - its commit survives only in
  // refs/pull/1/head, which the mirror has not fetched yet.
  await pushAsPullHead(await worktreeWithCommit('pr1', 'feature-one'), 1)
  states.set(pr(1), merged(ago(48), 1))

  // 2: merged, but a commit was made after the last push.
  const two = await worktreeWithCommit('pr2', 'feature-two')
  await pushAsPullHead(two, 2)
  writeFileSync(join(two, 'later.txt'), 'later\n')
  await git(two, 'add', '.')
  await git(two, 'commit', '-qm', 'unpushed')
  states.set(pr(2), merged(ago(48), 2))

  // 3: merged, with an edit to a tracked file.
  const three = await worktreeWithCommit('pr3', 'feature-three')
  await pushAsPullHead(three, 3)
  writeFileSync(join(three, 'README'), 'edited\n')
  states.set(pr(3), merged(ago(48), 3))

  // 4: merged, with only caches and ignored build output lying around.
  const four = await worktreeWithCommit('pr4', 'feature-four')
  await pushAsPullHead(four, 4)
  for (const dir of ['node_modules/left-pad', '__pycache__', 'ignored-build']) {
    mkdirSync(join(four, dir), { recursive: true })
    writeFileSync(join(four, dir, 'x'), 'x\n')
  }
  states.set(pr(4), merged(ago(48), 4))

  // 5: still open.
  await pushAsPullHead(await worktreeWithCommit('pr5', 'feature-five'), 5)
  states.set(pr(5), { state: { kind: 'open' }, openPullRequestOnBranch: false, relatedPullRequests: [5] })

  // 6: merged, but an agent session is in it.
  await pushAsPullHead(await worktreeWithCommit('pr6', 'feature-six'), 6)
  states.set(pr(6), merged(ago(48), 6))
  busy = { paths: new Set([canonical(wt('pr6'))]), preparingRepos: new Set() }

  // 7: merged an hour ago - inside the grace period.
  await pushAsPullHead(await worktreeWithCommit('pr7', 'feature-seven'), 7)
  states.set(pr(7), merged(ago(1), 7))

  // 8: a closed issue with a new file nobody committed.
  await git(mirror, 'worktree', 'add', '-b', 'issue-8', wt('issue8'), 'refs/remotes/origin/main')
  writeFileSync(join(wt('issue8'), 'notes.md'), 'draft\n')
  states.set(issue(8), {
    state: { kind: 'closed', at: ago(48) },
    openPullRequestOnBranch: false,
    relatedPullRequests: [],
  })

  // 9: closed without merging; the branch is still on the remote.
  const nine = await worktreeWithCommit('pr9', 'feature-nine')
  await git(nine, 'push', '-q', origin, 'HEAD:refs/heads/feature-nine')
  states.set(pr(9), { state: { kind: 'closed', at: ago(72) }, openPullRequestOnBranch: false, relatedPullRequests: [] })

  // 10: a closed issue whose fix was merged from its branch - still clean, and
  // HEAD is main, which is on the remote.
  await git(mirror, 'worktree', 'add', '-b', 'issue-10', wt('issue10'), 'refs/remotes/origin/main')
  states.set(issue(10), {
    state: { kind: 'closed', at: ago(48) },
    openPullRequestOnBranch: false,
    relatedPullRequests: [],
  })

  // A worktree shazam did not name is never considered.
  await git(mirror, 'worktree', 'add', '-b', 'hand-made', join(worktreesDir, 'something-else'), 'refs/remotes/origin/main')
})

after(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('sweepWorktrees', () => {
  it('a dry run reports without removing anything', async () => {
    const report = await sweep(true)
    assert.equal(report.dryRun, true)
    const would = report.entries.filter((e) => e.action === 'would-remove').map((e) => e.number)
    assert.deepEqual(would.sort((a, b) => a - b), [1, 4, 9, 10])
    for (const suffix of ['pr1', 'pr4', 'pr9', 'issue10']) assert.ok(existsSync(wt(suffix)))
    assert.ok(report.freedKb > 0)
  })

  it('removes only finished, clean, pushed and idle worktrees', async () => {
    const report = await sweep(false)
    const by = (s: string) => actionFor(report, s)

    assert.equal(by('pr1')?.action, 'removed')
    assert.equal(by('pr2')?.action, 'skipped')
    assert.match(by('pr2')?.reason ?? '', /not found on any remote ref/)
    assert.match(by('pr3')?.reason ?? '', /uncommitted changes/)
    assert.equal(by('pr4')?.action, 'removed')
    assert.equal(by('pr5')?.reason, 'still open')
    assert.equal(by('pr6')?.reason, 'a session is using it')
    assert.match(by('pr7')?.reason ?? '', /grace period/)
    assert.match(by('issue8')?.reason ?? '', /uncommitted changes \(\?\? notes.md\)/)
    assert.equal(by('pr9')?.action, 'removed')
    assert.equal(by('issue10')?.action, 'removed')
    assert.equal(report.entries.some((e) => e.path.endsWith('something-else')), false)

    for (const s of ['pr1', 'pr4', 'pr9', 'issue10']) assert.equal(existsSync(wt(s)), false, s)
    for (const s of ['pr2', 'pr3', 'pr5', 'pr6', 'pr7', 'issue8']) assert.ok(existsSync(wt(s)), s)

    // git forgot them too, and dropped branches that are safe upstream.
    const list = await git(mirror, 'worktree', 'list', '--porcelain')
    assert.equal(list.includes('acme-widget-pr1'), false)
    const branches = await git(mirror, 'branch', '--format=%(refname:short)')
    assert.equal(branches.split('\n').includes('feature-one'), false)
    assert.equal(branches.split('\n').includes('feature-two'), true)
  })

  it('leaves a repository alone while a session there is still preparing', async () => {
    busy = { paths: new Set(), preparingRepos: new Set(['acme/widget']) }
    const report = await sweep(true)
    assert.ok(report.entries.every((e) => e.action === 'skipped'))
  })
})

describe('GitHub state mapping', () => {
  const target = (kind: CleanupTarget['kind'], number: number): CleanupTarget => ({
    path: '/x',
    mirror: '/m',
    repo: 'acme/widget',
    kind,
    number,
    branch: kind === 'issue' ? `issue-${number}` : 'feat',
    head: null,
  })

  it('asks for the open PRs on an issue branch, and nothing extra for a PR', () => {
    const query = buildStateQuery([target('pull_request', 1), target('issue', 2)])
    assert.match(query, /t0: repository\(owner: "acme", name: "widget"\)/)
    assert.match(query, /issueOrPullRequest\(number: 2\)/)
    assert.equal((query.match(/headRefName/g) ?? []).length, 1)
  })

  it('maps merged and closed PRs, and issues closed by a PR', () => {
    assert.deepEqual(
      toTargetState(target('pull_request', 1), {
        item: { __typename: 'PullRequest', prState: 'MERGED', mergedAt: ago(5), closedAt: ago(5) },
      }).state,
      { kind: 'merged', at: ago(5) },
    )
    assert.deepEqual(
      toTargetState(target('pull_request', 1), {
        item: { __typename: 'PullRequest', prState: 'CLOSED', mergedAt: null, closedAt: ago(2) },
      }).state,
      { kind: 'closed', at: ago(2) },
    )
    const closedIssue = toTargetState(target('issue', 2), {
      item: {
        __typename: 'Issue',
        issueState: 'CLOSED',
        closedAt: ago(3),
        timelineItems: { nodes: [{ closer: { __typename: 'PullRequest', number: 40 } }] },
      },
      branchPrs: { totalCount: 1 },
    })
    assert.deepEqual(closedIssue, {
      state: { kind: 'closed', at: ago(3) },
      openPullRequestOnBranch: true,
      relatedPullRequests: [40],
    })
    assert.equal(toTargetState(target('issue', 3), null).state.kind, 'unknown')
  })
})
