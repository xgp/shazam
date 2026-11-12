import { type BrowserContext, type Page, test as base } from '@playwright/test'
import type {
  AgentSession,
  DashboardData,
  HealthReport,
  IssueItem,
  PullRequestItem,
  RepoRef,
} from '../src/shared/types.js'

/*
 * Synthetic board data. Every /api route the page calls is answered from here,
 * writes are refused, and the pty websocket is a stub that records what the
 * page sends - so the tests run with no server, no GitHub and no agent.
 */

const NOW = Date.now()
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const repo = (nameWithOwner: string): RepoRef => {
  const [owner = '', name = ''] = nameWithOwner.split('/')
  return { nameWithOwner, owner, name, url: `https://github.com/${nameWithOwner}` }
}

let serial = 0
function pr(overrides: Partial<PullRequestItem> & { repo: string; title: string }): PullRequestItem {
  serial += 1
  const { repo: name, ...rest } = overrides
  return {
    kind: 'pull_request',
    id: `PR_${serial}`,
    number: 100 + serial,
    url: `https://github.com/${name}/pull/${100 + serial}`,
    updatedAt: ago(serial * 7),
    createdAt: ago(serial * 60),
    isDraft: false,
    author: 'octocat',
    repo: repo(name),
    headRepo: repo(name),
    headRef: `feature-${serial}`,
    baseRef: 'main',
    checks: 'success',
    reviewDecision: 'review_required',
    mergeable: 'mergeable',
    mergeState: 'clean',
    commentCount: 0,
    pendingReviewerCount: 1,
    unresolvedThreadCount: 0,
    changedFiles: 3,
    additions: 120,
    deletions: 14,
    mergedAt: null,
    mergedBy: null,
    canMerge: true,
    viewerCanMerge: true,
    allowedMergeMethods: ['squash', 'merge', 'rebase'],
    ...rest,
  }
}

function issue(nameWithOwner: string, title: string): IssueItem {
  serial += 1
  return {
    kind: 'issue',
    id: `I_${serial}`,
    number: 10 + serial,
    title,
    url: `https://github.com/${nameWithOwner}/issues/${10 + serial}`,
    updatedAt: ago(serial * 11),
    createdAt: ago(serial * 90),
    author: 'octocat',
    repo: repo(nameWithOwner),
    commentCount: 2,
    labels: [{ name: 'bug', color: 'd73a4a' }],
  }
}

export const dashboard: DashboardData = {
  viewer: 'octocat',
  fetchedAt: new Date(NOW).toISOString(),
  error: null,
  rateLimit: { remaining: 4870, limit: 5000, resetAt: new Date(NOW + 40 * 60_000).toISOString() },
  columns: {
    myPullRequests: [
      pr({ repo: 'acme/rocket', title: 'Add a retry budget to the launch sequencer so transient faults stop aborting' }),
      pr({ repo: 'acme/rocket', title: 'Docs: fuel table units', checks: 'pending' }),
      pr({ repo: 'acme-labs/very-long-repository-name-for-wrapping', title: 'Short title', isDraft: true }),
      pr({ repo: 'acme/ground-control', title: 'Telemetry: drop duplicate frames', mergeable: 'conflicting', mergeState: 'dirty' }),
      pr({ repo: 'acme/ground-control', title: 'Fix flaky clock test', checks: 'failure' }),
    ],
    reviewRequests: [
      pr({ repo: 'globex/payments', title: 'Idempotency keys for refunds', author: 'hsimpson', commentCount: 8 }),
      pr({ repo: 'globex/payments', title: 'Bump node to 22', author: 'mburns', reviewDecision: 'changes_requested' }),
    ],
    approvedPrs: [
      pr({ repo: 'globex/web', title: 'Dark mode for the invoice view', author: 'lsimpson', reviewDecision: 'approved' }),
    ],
    recentlyMerged: [
      pr({ repo: 'acme/rocket', title: 'Stage separation timing', mergedAt: ago(30), mergedBy: 'octocat', reviewDecision: 'approved' }),
    ],
    assignedIssues: [issue('acme/rocket', 'Launch window calculator ignores leap seconds')],
    myIssues: [issue('acme/ground-control', 'Dashboard should work on a phone')],
  },
}

export const health: HealthReport = {
  ok: true,
  viewer: 'octocat',
  tools: [],
  agents: [
    { id: 'claude', label: 'Claude Code', available: true },
    { id: 'codex', label: 'Codex', available: true },
  ],
  defaultAgent: 'claude',
  pollIntervalMs: 60_000,
  terminalFontSize: 20,
  defaultMergeMethod: 'squash',
}

const firstPr = dashboard.columns.myPullRequests[0]!

export const sessions: AgentSession[] = [
  {
    id: 'session-1',
    agent: 'claude',
    status: 'running',
    activity: 'waiting',
    title: `${firstPr.repo.nameWithOwner}#${firstPr.number}`,
    kind: 'pull_request',
    itemId: firstPr.id,
    itemUrl: firstPr.url,
    itemNumber: firstPr.number,
    repo: firstPr.repo.nameWithOwner,
    branch: firstPr.headRef,
    worktreePath: '/tmp/worktrees/rocket',
    terminalId: 'shell-1',
    startedAt: ago(10),
    exitCode: null,
    note: null,
  },
  {
    id: 'session-2',
    agent: 'codex',
    status: 'running',
    activity: 'working',
    title: 'acme/ground-control#12',
    kind: 'issue',
    itemId: 'I_x',
    itemUrl: 'https://github.com/acme/ground-control/issues/12',
    itemNumber: 12,
    repo: 'acme/ground-control',
    branch: 'issue-12',
    worktreePath: '/tmp/worktrees/gc',
    terminalId: null,
    startedAt: ago(2),
    exitCode: null,
    note: null,
  },
]

/** What the page sent down each pty socket, keyed by session id. */
export type PtyLog = Map<string, { type: string; data?: string; cols?: number; rows?: number }[]>

export async function stubServer(
  context: BrowserContext,
  options: { sessions?: AgentSession[] } = {},
): Promise<PtyLog> {
  const list = options.sessions ?? sessions
  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      return route.fulfill({ status: 403, json: { ok: false, message: 'read-only test server' } })
    }
    if (path === '/api/health') return route.fulfill({ json: health })
    if (path === '/api/dashboard') return route.fulfill({ json: dashboard })
    if (path === '/api/sessions') return route.fulfill({ json: list })
    return route.fulfill({ status: 404, json: { ok: false, message: `no fixture for ${path}` } })
  })

  const log: PtyLog = new Map()
  await context.routeWebSocket(/\/ws\/pty/, (ws) => {
    const id = new URL(ws.url()).searchParams.get('id') ?? '?'
    const entries = log.get(id) ?? []
    log.set(id, entries)
    let greeted = false
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string }
      entries.push(message)
      if (!greeted && message.type === 'resize') {
        greeted = true
        ws.send(JSON.stringify({ type: 'output', data: `connected to ${id}\r\n> ` }))
      }
    })
  })
  return log
}

/** Loads the board signed in, with the stub server behind it. */
export const test = base.extend<{ pty: PtyLog; board: Page }>({
  pty: async ({ context }, use) => {
    await use(await stubServer(context))
  },
  board: async ({ page, pty }, use) => {
    void pty
    await page.goto('/?t=test-token')
    await page.locator('[data-item-id]').first().waitFor()
    await use(page)
  },
})

export { expect } from '@playwright/test'

/** True when the document itself scrolls sideways - the classic phone bug. */
export async function pageOverflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}
