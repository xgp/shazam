import { GraphqlResponseError } from '@octokit/graphql'
import {
  type ColumnId,
  type DashboardData,
  MERGED_LOOKBACK_DAYS,
  type PullRequestItem,
  mergeStateBlocks,
} from '../../shared/types.js'
import { branchMergeMethods } from './branchRules.js'
import { getGraphqlClient, resetClient } from './client.js'
import { applyMergeStates } from './mergeState.js'
import {
  normalizeIssue,
  normalizeMergedPr,
  normalizePr,
  type RawIssue,
  type RawMergedPr,
  type RawPr,
  viewerApproved,
} from './normalize.js'
import {
  APPROVED_PR_SEARCH_QUERY,
  ISSUE_SEARCH_QUERY,
  MERGED_PR_SEARCH_QUERY,
  PR_SEARCH_QUERY,
  SEARCH_QUERIES,
} from './queries.js'

interface RateLimit {
  limit: number
  remaining: number
  resetAt: string
}

/** Every column's request carries the same context alongside its own search. */
interface RawSearchResponse<T> {
  viewer: { login: string } | null
  search: { nodes: (T | null)[] } | null
  rateLimit: RateLimit | null
}

/** Search can return empty objects for items the token cannot fully read. */
const present = <T extends { id?: string }>(nodes: (T | null)[]): T[] =>
  nodes.filter((n): n is T => n != null && n.id != null)

/**
 * `is:open` in the search string is not enough. GitHub's search index is
 * eventually consistent, so something you just closed or merged keeps matching
 * for a while, and comes back with fresh field values - which shows up as a row
 * that updates but never leaves the list. The item's own state is authoritative.
 */
export const isOpen = <T extends { state?: string }>(node: T): boolean =>
  node.state === undefined || node.state === 'OPEN'

const byUpdatedDesc = <T extends { updatedAt: string }>(a: T, b: T) =>
  b.updatedAt.localeCompare(a.updatedAt)

/** Search cannot sort by merge time, so the merged column sorts itself. */
const byMergedDesc = (a: PullRequestItem, b: PullRequestItem) =>
  (b.mergedAt ?? '').localeCompare(a.mergedAt ?? '')

const DAY_MS = 24 * 60 * 60 * 1000


/**
 * Narrow each PR's merge methods by any ruleset on its base branch. Only asked
 * for PRs whose Merge button is actually live, so the extra REST calls stay in
 * single digits and are then served from cache.
 */
export async function applyBranchRules(prs: PullRequestItem[]): Promise<void> {
  // Mirrors the Merge button's own enabled condition, so every PR you can
  // actually click has had its methods narrowed - including one whose
  // mergeability GitHub is still computing.
  const eligible = prs.filter(
    (pr) =>
      !pr.isDraft &&
      pr.reviewDecision === 'approved' &&
      pr.mergeable !== 'conflicting' &&
      !mergeStateBlocks(pr.mergeState) &&
      pr.allowedMergeMethods.length > 0,
  )

  await Promise.all(
    eligible.map(async (pr) => {
      const permitted = await branchMergeMethods(pr.repo.nameWithOwner, pr.baseRef)
      if (!permitted) return
      pr.allowedMergeMethods = pr.allowedMergeMethods.filter((m) => permitted.includes(m))
    }),
  )
}

/** Runs one column's search and hands back its rows plus the shared context. */
async function fetchSearch<T extends { id?: string; state?: string }>(
  query: string,
  search: string,
  limit: number,
  /** The merged column wants exactly the rows `isOpen` exists to drop. */
  keep: (node: T) => boolean = isOpen,
): Promise<{ rows: T[]; viewer: string; rateLimit: RateLimit | null }> {
  const client = await getGraphqlClient()

  let data: RawSearchResponse<T>
  try {
    data = await withGatewayRetry(() => client<RawSearchResponse<T>>(query, { search, limit }))
  } catch (err) {
    // Partial failures are common: one unreadable repo in a result set errors
    // that node but GitHub still returns everything else.
    if (err instanceof GraphqlResponseError && err.data) {
      data = err.data as RawSearchResponse<T>
    } else {
      throw err
    }
  }

  return {
    rows: present(data.search?.nodes ?? []).filter(keep),
    viewer: data.viewer?.login ?? '',
    rateLimit: data.rateLimit,
  }
}

/** Pauses before each retry of a search GitHub timed out on. */
const GATEWAY_RETRY_DELAYS_MS = [1_000, 3_000]

/**
 * Even split per column, a search still lands on GitHub's ~10s ceiling now and
 * then and comes back as a 502/504 page. Those are transient - the same query
 * usually answers on the next try - so retry them here rather than turning
 * every one into a stale-column banner for a whole poll interval.
 */
async function withGatewayRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run()
    } catch (err) {
      const delay = GATEWAY_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !isGatewayTimeout(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

function isGatewayTimeout(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return status === 502 || status === 503 || status === 504
}

/** Human names, for the banner that says which column went stale. */
const COLUMN_TITLES: Record<ColumnId, string> = {
  myPullRequests: 'My pull requests',
  reviewRequests: 'Waiting on my review',
  approvedPrs: 'Approved, awaiting merge',
  recentlyMerged: 'Merged recently',
  myIssues: 'Issues I opened',
  assignedIssues: 'Issues assigned to me',
}

/**
 * Fetches every column in parallel, keeping whatever `previous` holds for any
 * that fails. One column timing out used to mean the whole dashboard froze on
 * its last good payload; now it means one list is a minute stale and says so.
 */
export async function fetchDashboard(
  limit: number,
  previous: DashboardData = EMPTY,
): Promise<DashboardData> {
  const prSearch = (search: string) => () => fetchSearch<RawPr>(PR_SEARCH_QUERY, search, limit)
  const issueSearch = (search: string) => () =>
    fetchSearch<RawIssue>(ISSUE_SEARCH_QUERY, search, limit)

  const mergedSince = new Date(Date.now() - MERGED_LOOKBACK_DAYS * DAY_MS)

  const [myPullRequests, reviewRequests, approvedPrs, recentlyMerged, myIssues, assignedIssues] =
    await Promise.all([
      settle('myPullRequests', prSearch(SEARCH_QUERIES.myPullRequests)),
      settle('reviewRequests', prSearch(SEARCH_QUERIES.reviewRequests)),
      settle('approvedPrs', () =>
        fetchSearch<RawPr>(APPROVED_PR_SEARCH_QUERY, SEARCH_QUERIES.approvedPrs, limit),
      ),
      settle('recentlyMerged', () =>
        fetchSearch<RawMergedPr>(
          MERGED_PR_SEARCH_QUERY,
          SEARCH_QUERIES.recentlyMerged(mergedSince.toISOString().slice(0, 10)),
          limit,
          (node) => node.state === 'MERGED',
        ),
      ),
      settle('myIssues', issueSearch(SEARCH_QUERIES.myIssues)),
      settle('assignedIssues', issueSearch(SEARCH_QUERIES.myIssuesAssigned)),
    ])

  const results = [
    myPullRequests,
    reviewRequests,
    approvedPrs,
    recentlyMerged,
    myIssues,
    assignedIssues,
  ]
  const failed = results.filter((r) => r.error !== null)
  if (failed.length === results.length) {
    // Nothing got through: this is not one slow column, it is GitHub or the
    // token, and the caller needs to treat it as a failed poll.
    throw new Error(failed[0]?.error ?? 'Every column failed')
  }

  // Any column that answered knows who we are and what quota is left.
  const context = results.find((r) => r.value !== null)?.value
  const viewer = results.map((r) => r.value?.viewer).find(Boolean) ?? previous.viewer

  const freshPrs = (
    result: Settled<RawPr>,
    fallback: PullRequestItem[],
    keep: (raw: RawPr) => boolean = () => true,
  ): { rows: PullRequestItem[]; isFresh: boolean } =>
    result.value
      ? { rows: result.value.rows.filter(keep).map(normalizePr).sort(byUpdatedDesc), isFresh: true }
      : { rows: fallback, isFresh: false }

  const mine = freshPrs(myPullRequests, previous.columns.myPullRequests)
  const requested = freshPrs(reviewRequests, previous.columns.reviewRequests)
  // The search only knows the viewer reviewed these; approval is decided here,
  // off the viewer's own latest opinionated review on each row.
  const approved = freshPrs(approvedPrs, previous.columns.approvedPrs, (raw) =>
    viewerApproved(raw, viewer),
  )

  // `involves:` over-fetches; keep what is yours, inside the exact window.
  const merged = recentlyMerged.value
    ? recentlyMerged.value.rows
        .filter(
          (raw) =>
            (raw.author?.login === viewer || raw.mergedBy?.login === viewer) &&
            raw.mergedAt !== null &&
            new Date(raw.mergedAt) >= mergedSince,
        )
        .map(normalizeMergedPr)
    : previous.columns.recentlyMerged

  const columns = {
    myPullRequests: mine.rows,
    reviewRequests: requested.rows,
    approvedPrs: approved.rows,
    recentlyMerged: [...merged].sort(byMergedDesc),
    myIssues: myIssues.value
      ? myIssues.value.rows.map(normalizeIssue).sort(byUpdatedDesc)
      : previous.columns.myIssues,
    assignedIssues: assignedIssues.value
      ? assignedIssues.value.rows.map(normalizeIssue).sort(byUpdatedDesc)
      : previous.columns.assignedIssues,
  }

  // Order matters: branch rules only narrow the methods of PRs that can still
  // merge, and that set is not known until the merge states are in. Only rows
  // we just fetched need it - the ones carried over already have theirs.
  const mergeablePrs = [
    ...(mine.isFresh ? mine.rows : []),
    ...(approved.isFresh ? approved.rows : []),
  ]
  await applyMergeStates(mergeablePrs)
  await applyBranchRules(mergeablePrs)

  return {
    viewer,
    fetchedAt: new Date().toISOString(),
    error:
      failed.length === 0
        ? null
        : `Could not refresh ${failed
            .map((r) => COLUMN_TITLES[r.id])
            .join(', ')} - showing the rows from the last good poll. (${failed[0]?.error})`,
    rateLimit: context?.rateLimit ?? previous.rateLimit,
    columns,
  }
}

interface Settled<T> {
  id: ColumnId
  value: { rows: T[]; viewer: string; rateLimit: RateLimit | null } | null
  error: string | null
}

/** Never rejects: a column's failure is data about that column, not the poll. */
async function settle<T>(
  id: ColumnId,
  run: () => Promise<{ rows: T[]; viewer: string; rateLimit: RateLimit | null }>,
): Promise<Settled<T>> {
  try {
    return { id, value: await run(), error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`shazam: column ${id} failed: ${message}`)
    return { id, value: null, error: firstLine(message) }
  }
}

/**
 * GitHub's timeout arrives as an nginx HTML page often enough to matter, and a
 * banner is no place for a `<html>` document.
 */
function firstLine(message: string): string {
  if (/<html/i.test(message)) {
    const title = message.match(/<title>([^<]+)<\/title>/i)?.[1]
    return title?.trim() ?? 'GitHub returned an error page'
  }
  return message.split('\n')[0]?.trim() ?? message
}

const EMPTY: DashboardData = {
  viewer: '',
  fetchedAt: new Date(0).toISOString(),
  error: null,
  rateLimit: null,
  columns: {
    myPullRequests: [],
    reviewRequests: [],
    approvedPrs: [],
    recentlyMerged: [],
    myIssues: [],
    assignedIssues: [],
  },
}

/**
 * Polls GitHub on an interval into an in-memory cache. Clients read the cache,
 * so extra browser tabs and manual refreshes cost nothing against the API.
 */
export class DashboardPoller {
  private data: DashboardData = EMPTY
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<DashboardData> | null = null
  private consecutiveFailures = 0
  private firstRun: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly intervalMs: number,
    private readonly limit: number,
  ) {}

  get snapshot(): DashboardData {
    return this.data
  }

  /**
   * Resolves once the first poll has landed, so a browser that connects during
   * startup gets real rows instead of an empty dashboard. Capped, because a
   * slow or unreachable GitHub must not hang the page load.
   */
  async ready(timeoutMs = 10_000): Promise<void> {
    await Promise.race([
      this.firstRun,
      new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ])
  }

  start(): void {
    if (this.timer) return
    this.firstRun = this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Coalesces concurrent callers onto one in-flight request. */
  async refresh(): Promise<DashboardData> {
    if (this.inFlight) return this.inFlight

    this.inFlight = this.run()
    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async run(): Promise<DashboardData> {
    try {
      this.data = await fetchDashboard(this.limit, this.data)
      this.consecutiveFailures = 0
    } catch (err) {
      this.consecutiveFailures += 1
      // A rotated or expired gh token is the likeliest cause; force a re-read.
      if (this.consecutiveFailures === 1) resetClient()
      const message = err instanceof Error ? err.message : String(err)
      console.error(`shazam: poll failed (${this.consecutiveFailures}x): ${message}`)
      // Keep serving the last good payload; the UI surfaces `error` as a banner.
      this.data = { ...this.data, error: message }
    }
    return this.data
  }
}
