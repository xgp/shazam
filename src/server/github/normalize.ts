import {
  type Approval,
  type CardReviewer,
  type CheckState,
  type IssueItem,
  type MergeMethod,
  type MergeableState,
  type PullRequestItem,
  type ReviewerState,
  type RepoRef,
  type ReviewDecision,
  reviewSatisfied,
} from '../../shared/types.js'

interface RawRepo {
  nameWithOwner: string
  name: string
  url: string
  owner: { login: string }
}

/** The base repo of a PR also tells us which merge buttons it has enabled. */
interface RawBaseRepo extends RawRepo {
  squashMergeAllowed: boolean
  mergeCommitAllowed: boolean
  rebaseMergeAllowed: boolean
  /** Null for a repo the viewer can only see through the PR. */
  viewerPermission: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ' | null
}

/** Merging needs push access: WRITE or better on the BASE repo. Your own PR
 * from a fork does not carry it - the button must know the difference. */
function viewerCanMerge(repo: RawBaseRepo): boolean {
  return repo.viewerPermission === 'ADMIN' ||
    repo.viewerPermission === 'MAINTAIN' ||
    repo.viewerPermission === 'WRITE'
}

export interface RawPr {
  id: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  updatedAt: string
  createdAt: string
  mergedAt: string | null
  mergedBy: { login: string } | null
  isDraft: boolean
  author: { login: string } | null
  repository: RawBaseRepo
  headRepository: RawRepo | null
  headRefName: string
  baseRefName: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  changedFiles: number
  additions: number
  deletions: number
  comments: { totalCount: number }
  reviewRequests: {
    totalCount: number
    /** Absent on the merged column's lean query. A team has no login. */
    nodes?: ({ requestedReviewer: { login?: string } | null } | null)[]
  }
  reviewThreads: { nodes: ({ isResolved: boolean } | null)[] }
  commits: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] }
  /** Absent on the merged column's lean query. */
  latestOpinionatedReviews?: {
    nodes: ({ state: string; submittedAt?: string | null; author: { login: string } | null } | null)[]
  }
}

/**
 * Whether the viewer's standing verdict on the PR is an approval. GitHub keeps
 * one opinionated review per author - a later comment-only review does not
 * displace it - so this is exactly the green "approved" the PR page shows next
 * to the viewer's name, and a dismissed approval no longer counts.
 */
export function viewerApproved(raw: RawPr, viewer: string): boolean {
  return (raw.latestOpinionatedReviews?.nodes ?? []).some(
    (review) => review?.state === 'APPROVED' && review.author?.login === viewer,
  )
}

const REVIEW_STATES: Record<string, ReviewerState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
}

/**
 * People on the PR: asked and waiting first, then standing reviews. A person
 * asked again after reviewing is waiting, so the request wins.
 */
function cardReviewers(raw: RawPr): CardReviewer[] {
  const out: CardReviewer[] = []
  const seen = new Set<string>()
  for (const node of raw.reviewRequests.nodes ?? []) {
    const login = node?.requestedReviewer?.login
    if (!login || seen.has(login)) continue
    seen.add(login)
    out.push({ login, state: 'pending' })
  }
  for (const review of raw.latestOpinionatedReviews?.nodes ?? []) {
    const login = review?.author?.login
    const state = review ? REVIEW_STATES[review.state] : undefined
    if (!login || !state || seen.has(login)) continue
    seen.add(login)
    out.push({ login, state })
  }
  return out
}

/** Each reviewer whose standing verdict is an approval, earliest first. */
function approvals(raw: RawPr): Approval[] {
  const out: Approval[] = []
  for (const review of raw.latestOpinionatedReviews?.nodes ?? []) {
    if (review?.state !== 'APPROVED') continue
    out.push({ login: review.author?.login ?? 'ghost', submittedAt: review.submittedAt ?? null })
  }
  return out.sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
}

export interface RawIssue {
  id: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED'
  updatedAt: string
  createdAt: string
  author: { login: string } | null
  repository: RawRepo
  comments: { totalCount: number }
  labels: { nodes: ({ name: string; color: string } | null)[] }
}

function repoRef(raw: RawRepo): RepoRef {
  return {
    nameWithOwner: raw.nameWithOwner,
    owner: raw.owner.login,
    name: raw.name,
    url: raw.url,
  }
}

/** Preference order for picking a fallback when the configured method is off. */
function allowedMergeMethods(raw: RawBaseRepo): MergeMethod[] {
  const methods: MergeMethod[] = []
  if (raw.squashMergeAllowed) methods.push('squash')
  if (raw.mergeCommitAllowed) methods.push('merge')
  if (raw.rebaseMergeAllowed) methods.push('rebase')
  return methods
}

function checkState(raw: RawPr): CheckState {
  const state = raw.commits.nodes[0]?.commit.statusCheckRollup?.state
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

function reviewDecision(raw: RawPr): ReviewDecision {
  switch (raw.reviewDecision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return 'none'
  }
}

function mergeable(raw: RawPr): MergeableState {
  switch (raw.mergeable) {
    case 'MERGEABLE':
      return 'mergeable'
    case 'CONFLICTING':
      return 'conflicting'
    default:
      return 'unknown'
  }
}

export function normalizePr(raw: RawPr): PullRequestItem {
  const checks = checkState(raw)
  const decision = reviewDecision(raw)
  const merge = mergeable(raw)

  return {
    kind: 'pull_request',
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    isDraft: raw.isDraft,
    author: raw.author?.login ?? null,
    repo: repoRef(raw.repository),
    headRepo: raw.headRepository ? repoRef(raw.headRepository) : null,
    headRef: raw.headRefName,
    baseRef: raw.baseRefName,
    checks,
    reviewDecision: decision,
    approvals: approvals(raw),
    mergeable: merge,
    // Too expensive to ask for in the dashboard query; applyMergeStates fills
    // it in afterwards for the few PRs whose Merge button is otherwise live.
    mergeState: 'unknown',
    commentCount: raw.comments.totalCount,
    pendingReviewerCount: raw.reviewRequests.totalCount,
    reviewers: cardReviewers(raw),
    unresolvedThreadCount: raw.reviewThreads.nodes.filter((n) => n && !n.isResolved).length,
    changedFiles: raw.changedFiles,
    additions: raw.additions,
    deletions: raw.deletions,
    mergedAt: raw.mergedAt ?? null,
    mergedBy: raw.mergedBy?.login ?? null,
    // Push access, reviews satisfied, no conflicts, not a draft. A red check is
    // deliberately not disqualifying on its own: unless a branch rule requires
    // that check, GitHub merges it. applyMergeStates refines this with
    // GitHub's own answer.
    canMerge:
      viewerCanMerge(raw.repository) &&
      !raw.isDraft &&
      reviewSatisfied(decision) &&
      merge !== 'conflicting',
    viewerCanMerge: viewerCanMerge(raw.repository),
    allowedMergeMethods: allowedMergeMethods(raw.repository),
  }
}

/** What MERGED_PR_SEARCH_QUERY leaves out of PrFields. */
type MergedOmitted = 'mergeable' | 'reviewDecision' | 'reviewRequests' | 'reviewThreads'

export interface RawMergedPr extends Omit<RawPr, MergedOmitted | 'repository'> {
  repository: RawRepo
}

/**
 * The lean merged shape, filled out with values that render as "nothing to
 * say": no decision, no threads, no permission - so canMerge is false and the
 * card shows no merge controls even before it checks mergedAt.
 */
export function normalizeMergedPr(raw: RawMergedPr): PullRequestItem {
  return normalizePr({
    ...raw,
    repository: {
      ...raw.repository,
      squashMergeAllowed: false,
      mergeCommitAllowed: false,
      rebaseMergeAllowed: false,
      viewerPermission: null,
    },
    mergeable: 'UNKNOWN',
    reviewDecision: null,
    reviewRequests: { totalCount: 0 },
    reviewThreads: { nodes: [] },
  })
}

export function normalizeIssue(raw: RawIssue): IssueItem {
  return {
    kind: 'issue',
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    author: raw.author?.login ?? null,
    repo: repoRef(raw.repository),
    commentCount: raw.comments.totalCount,
    labels: raw.labels.nodes.filter((l): l is { name: string; color: string } => l !== null),
  }
}
