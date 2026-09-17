/**
 * DTOs shared by the server and the web client. Everything the UI renders is
 * normalized into these shapes so a column's data source can be swapped
 * without the components knowing where the rows came from.
 */

export type CheckState = 'success' | 'failure' | 'pending' | 'none'

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | 'none'

export type MergeableState = 'mergeable' | 'conflicting' | 'unknown'

/**
 * GitHub's own verdict on whether the merge button would work, which is more
 * than `mergeable` knows: `unstable` is a red or pending check that no rule
 * requires - GitHub merges it happily - while `blocked` is one that a rule
 * does require, and no amount of green elsewhere gets past it.
 */
export type MergeState =
  | 'clean'
  | 'unstable'
  | 'has_hooks'
  | 'blocked'
  | 'behind'
  | 'dirty'
  | 'draft'
  | 'unknown'

/**
 * The states GitHub would refuse a merge in. Everything else - including
 * `unknown`, which is just GitHub still working it out - lets the button live.
 */
export const BLOCKING_MERGE_STATES = ['blocked', 'behind', 'dirty', 'draft'] as const satisfies
  readonly MergeState[]

export type BlockingMergeState = (typeof BLOCKING_MERGE_STATES)[number]

export function mergeStateBlocks(state: MergeState): state is BlockingMergeState {
  return (BLOCKING_MERGE_STATES as readonly MergeState[]).includes(state)
}

/**
 * Whether reviews stand in the way of merging. `none` satisfies: it is what
 * GitHub answers on a repo with no required-review rule - most personal
 * projects - and GitHub merges those without an approval. Only a rule still
 * waiting (`review_required`) or a standing objection blocks.
 */
export function reviewSatisfied(decision: ReviewDecision): boolean {
  return decision === 'approved' || decision === 'none'
}

export interface RepoRef {
  /** e.g. "octocat/hello-world" */
  nameWithOwner: string
  owner: string
  name: string
  url: string
}

export interface PullRequestItem {
  kind: 'pull_request'
  id: string
  number: number
  title: string
  url: string
  updatedAt: string
  createdAt: string
  isDraft: boolean
  author: string | null
  repo: RepoRef
  /** Repo the branch lives in - differs from `repo` for fork PRs. */
  headRepo: RepoRef | null
  headRef: string
  baseRef: string
  checks: CheckState
  reviewDecision: ReviewDecision
  mergeable: MergeableState
  /** Whether GitHub would take the merge, and if not, why. */
  mergeState: MergeState
  /** Issue-level comments. */
  commentCount: number
  /** Reviewers who have been asked and have not answered. */
  pendingReviewerCount: number
  /** Unresolved inline review threads. */
  unresolvedThreadCount: number
  changedFiles: number
  additions: number
  deletions: number
  /** True when the viewer can merge it right now, per GitHub. */
  canMerge: boolean
  /**
   * Push access to the base repo (WRITE or better). Your own fork PR into
   * someone else's repo is everything else on this card - open, yours,
   * mergeable - and still not yours to merge.
   */
  viewerCanMerge: boolean
  /**
   * Merge methods the base repository actually permits, in preference order.
   * Empty when the repo has disabled all of them.
   */
  allowedMergeMethods: MergeMethod[]
}

export interface IssueItem {
  kind: 'issue'
  id: string
  number: number
  title: string
  url: string
  updatedAt: string
  createdAt: string
  author: string | null
  repo: RepoRef
  commentCount: number
  labels: { name: string; color: string }[]
}

export type DashboardItem = PullRequestItem | IssueItem

// ---------------------------------------------------------------------------
// Reviewers
// ---------------------------------------------------------------------------

/**
 * Per-person, unlike `ReviewDecision`, which is GitHub's single verdict for the
 * whole pull request. `pending` is a request nobody has answered yet.
 */
export type ReviewerState =
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'commented'
  | 'dismissed'

export interface ReviewerCandidate {
  /** A login, or "org/team" for a team. */
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface Reviewer extends ReviewerCandidate {
  isTeam: boolean
  state: ReviewerState
}

/** Who is on a pull request, and who else could be asked. */
export interface ReviewersPanel {
  /** Everyone on it now: requested, or having already left a review. */
  reviewers: Reviewer[]
  /** Collaborators who could be asked, minus the author and the above. */
  candidates: ReviewerCandidate[]
  /** True when the repository has more collaborators than we fetched. */
  truncated: boolean
  /** Set when we cannot list collaborators at all, with the reason. */
  note: string | null
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * `review` is a submitted review's own body (the "approved with a note" text);
 * `review_comment` is one anchored to a line of the diff.
 */
export type CommentKind = 'comment' | 'review' | 'review_comment'

export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed'

export interface CommentItem {
  id: string
  kind: CommentKind
  author: string | null
  avatarUrl: string | null
  /**
   * The comment as GitHub itself renders it: GFM turned into HTML, with any
   * HTML the author wrote inline already handled. Sanitized again in the
   * browser before it is put in the document.
   */
  bodyHtml: string
  createdAt: string
  url: string
  /** Set on `review` only. */
  reviewState: ReviewState | null
  /** File the thread hangs off; set on `review_comment` only. */
  path: string | null
  /** Set on `review_comment` only. */
  isResolved: boolean | null
}

/** The conversation on one PR or issue, oldest first. */
export interface CommentThread {
  /** The PR or issue itself, for the "open on GitHub" escape hatch. */
  url: string
  comments: CommentItem[]
  /** True when the conversation is longer than what we fetched. */
  truncated: boolean
}

export interface RateLimit {
  remaining: number
  limit: number
  resetAt: string
}

/** One poll's worth of data. Keyed by column id. */
export interface DashboardData {
  viewer: string
  fetchedAt: string
  /** Set when the most recent poll failed; the payload is the last good one. */
  error: string | null
  rateLimit: RateLimit | null
  columns: {
    myPullRequests: PullRequestItem[]
    reviewRequests: PullRequestItem[]
    /** Someone else's open PRs that the viewer has approved and not seen merge. */
    approvedPrs: PullRequestItem[]
    myIssues: IssueItem[]
    assignedIssues: IssueItem[]
  }
}

export type ColumnId = keyof DashboardData['columns']

// ---------------------------------------------------------------------------
// Preflight / health
// ---------------------------------------------------------------------------

export type ToolStatus = 'ok' | 'missing' | 'error'

export interface ToolCheck {
  name: string
  /** A failed required tool stops the server from starting. */
  required: boolean
  status: ToolStatus
  version: string | null
  detail: string | null
}

export interface HealthReport {
  ok: boolean
  viewer: string | null
  tools: ToolCheck[]
  /** Agents that actually launched their preflight check, for the shazam menu. */
  agents: { id: AgentId; label: string; available: boolean }[]
  /** Config's preferred agent; what a plain Shazam click opens. */
  defaultAgent: AgentId
  pollIntervalMs: number
  terminalFontSize: number
  defaultMergeMethod: MergeMethod
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export interface ActionResult {
  ok: boolean
  message: string
}

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

export type AgentId = 'claude' | 'codex'

/**
 * What a session is being opened to do, which in practice is a choice of
 * opening prompt. `brief` reads the pull request and waits for instruction;
 * `address` goes straight at the changes a reviewer asked for; `conflict`
 * goes at the merge conflict holding the branch up.
 */
export type ShazamIntent = 'brief' | 'address' | 'conflict'

export type SessionStatus = 'preparing' | 'running' | 'exited' | 'failed'

export interface AgentSession {
  id: string
  agent: AgentId
  status: SessionStatus
  title: string
  prUrl: string
  repo: string
  prNumber: number
  branch: string
  worktreePath: string | null
  startedAt: string
  exitCode: number | null
  /** Populated while status is 'preparing' or on 'failed'. */
  note: string | null
}

// ---------------------------------------------------------------------------
// PTY websocket protocol
// ---------------------------------------------------------------------------

export type PtyClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

export type PtyServerMessage =
  | { type: 'output'; data: string }
  | { type: 'status'; session: AgentSession }
  | { type: 'error'; message: string }
