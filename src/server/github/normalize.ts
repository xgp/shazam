import {
  type CheckState,
  type IssueItem,
  type MergeMethod,
  type MergeableState,
  type PullRequestItem,
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
}

export interface RawPr {
  id: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  updatedAt: string
  createdAt: string
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
  reviewRequests: { totalCount: number }
  reviewThreads: { nodes: ({ isResolved: boolean } | null)[] }
  commits: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] }
  /** Fetched only by the approvedPrs search; the other aliases skip it. */
  latestOpinionatedReviews?: {
    nodes: ({ state: string; author: { login: string } | null } | null)[]
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
    mergeable: merge,
    // Too expensive to ask for in the dashboard query; applyMergeStates fills
    // it in afterwards for the few PRs whose Merge button is otherwise live.
    mergeState: 'unknown',
    commentCount: raw.comments.totalCount,
    pendingReviewerCount: raw.reviewRequests.totalCount,
    unresolvedThreadCount: raw.reviewThreads.nodes.filter((n) => n && !n.isResolved).length,
    changedFiles: raw.changedFiles,
    additions: raw.additions,
    deletions: raw.deletions,
    // Reviews satisfied, no conflicts, not a draft. A red check is deliberately
    // not disqualifying on its own: unless a branch rule requires that check,
    // GitHub merges it. applyMergeStates refines this with GitHub's own answer.
    canMerge: !raw.isDraft && reviewSatisfied(decision) && merge !== 'conflicting',
    allowedMergeMethods: allowedMergeMethods(raw.repository),
  }
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
