/**
 * One request per column, not one per poll.
 *
 * All five searches used to ride in a single request, which was a nice
 * property right up until the fifth column: GitHub runs each search, and the
 * whole thing started landing at 10-12s against a roughly 10s ceiling, so
 * something like two polls in five came back as a timeout or the 502 that
 * nginx turns it into. Split, each request is comfortably inside the limit,
 * they go out in parallel so the wall time is the slowest one rather than the
 * sum, and a column that does fail no longer takes the other four with it.
 */

const REPO_FRAGMENT = /* GraphQL */ `
  fragment RepoFields on Repository {
    nameWithOwner
    name
    url
    owner {
      login
    }
  }
`

const PR_FRAGMENT = /* GraphQL */ `
  fragment PrFields on PullRequest {
    id
    number
    title
    url
    state
    updatedAt
    createdAt
    mergedAt
    mergedBy {
      login
    }
    isDraft
    author {
      login
    }
    repository {
      ...RepoFields
      squashMergeAllowed
      mergeCommitAllowed
      rebaseMergeAllowed
      viewerPermission
    }
    headRepository {
      ...RepoFields
    }
    headRefName
    baseRefName
    mergeable
    reviewDecision
    changedFiles
    additions
    deletions
    comments {
      totalCount
    }
    reviewRequests(first: 0) {
      totalCount
    }
    reviewThreads(first: 50) {
      nodes {
        isResolved
      }
    }
    commits(last: 1) {
      nodes {
        commit {
          statusCheckRollup {
            state
          }
        }
      }
    }
  }
`

const ISSUE_FRAGMENT = /* GraphQL */ `
  fragment IssueFields on Issue {
    id
    number
    title
    url
    state
    updatedAt
    createdAt
    author {
      login
    }
    repository {
      ...RepoFields
    }
    comments {
      totalCount
    }
    labels(first: 10) {
      nodes {
        name
        color
      }
    }
  }
`

/**
 * Carried by every column's request rather than costing a sixth. Both are
 * near-free next to a search, and having them on each one means the viewer's
 * login and the remaining quota survive any single column failing.
 */
const CONTEXT_FIELDS = /* GraphQL */ `
  viewer {
    login
  }
  rateLimit {
    limit
    remaining
    resetAt
  }
`

export const PR_SEARCH_QUERY = /* GraphQL */ `
  ${REPO_FRAGMENT}
  ${PR_FRAGMENT}
  query PrSearch($search: String!, $limit: Int!) {
    ${CONTEXT_FIELDS}
    search(query: $search, type: ISSUE, first: $limit) {
      nodes {
        ...PrFields
      }
    }
  }
`

/**
 * The approved column pays for review nodes the others do not need: search can
 * say "the viewer reviewed it" but not "the viewer's review was an approval",
 * so the poller reads the viewer's standing verdict off each row and keeps the
 * approved ones.
 */
export const APPROVED_PR_SEARCH_QUERY = /* GraphQL */ `
  ${REPO_FRAGMENT}
  ${PR_FRAGMENT}
  query ApprovedPrSearch($search: String!, $limit: Int!) {
    ${CONTEXT_FIELDS}
    search(query: $search, type: ISSUE, first: $limit) {
      nodes {
        ...PrFields
        ... on PullRequest {
          latestOpinionatedReviews(first: 10) {
            nodes {
              state
              author {
                login
              }
            }
          }
        }
      }
    }
  }
`

/**
 * The merged column's own, leaner shape. Over the same hundred rows, PrFields
 * ran 11s - past GitHub's ceiling, so the column came back as a 502 - and
 * most of that was fields a merged PR has nothing to say with: mergeability,
 * review decision, review threads and repository merge settings each cost a
 * second or two. normalizeMergedPr fills them with neutral values.
 */
export const MERGED_PR_SEARCH_QUERY = /* GraphQL */ `
  ${REPO_FRAGMENT}
  query MergedPrSearch($search: String!, $limit: Int!) {
    ${CONTEXT_FIELDS}
    search(query: $search, type: ISSUE, first: $limit) {
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          state
          updatedAt
          createdAt
          mergedAt
          mergedBy {
            login
          }
          isDraft
          author {
            login
          }
          repository {
            ...RepoFields
          }
          headRepository {
            ...RepoFields
          }
          headRefName
          baseRefName
          changedFiles
          additions
          deletions
          comments {
            totalCount
          }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
    }
  }
`

export const ISSUE_SEARCH_QUERY = /* GraphQL */ `
  ${REPO_FRAGMENT}
  ${ISSUE_FRAGMENT}
  query IssueSearch($search: String!, $limit: Int!) {
    ${CONTEXT_FIELDS}
    search(query: $search, type: ISSUE, first: $limit) {
      nodes {
        ...IssueFields
      }
    }
  }
`

export const SEARCH_QUERIES = {
  myPullRequests: 'is:open is:pr author:@me archived:false sort:updated-desc',
  /**
   * `-reviewed-by:@me` is what makes this "outstanding": GitHub keeps a review
   * request listed after you submit a review, and we only want untouched ones.
   */
  reviewRequests:
    'is:open is:pr review-requested:@me -author:@me -reviewed-by:@me archived:false sort:updated-desc',
  /**
   * `-review-requested:@me` keeps a PR whose review was re-requested after
   * your approval in "Waiting on my review" instead of both columns. Search
   * cannot narrow `reviewed-by:@me` to approvals (`review:approved` is the
   * PR's overall decision, not yours), so the poller filters these rows by the
   * viewer's own latest opinionated review.
   */
  approvedPrs:
    'is:open is:pr reviewed-by:@me -author:@me -review-requested:@me archived:false sort:updated-desc',
  /**
   * Search has no `merged-by:` qualifier, so `involves:@me` casts the net -
   * author, reviewer, commenter, assignee - and the poller keeps the rows you
   * authored or merged yourself. A PR you merged without ever touching it
   * otherwise (a bot's, say) falls outside the net. The date is day-granular;
   * the poller trims to the exact window.
   */
  recentlyMerged: (since: string) =>
    `is:pr is:merged involves:@me merged:>=${since} archived:false sort:updated-desc`,
  myIssues: 'is:open is:issue author:@me archived:false sort:updated-desc',
  /**
   * `-author:@me` keeps the two issue columns disjoint, the same way
   * reviewRequests excludes your own PRs - assigning yourself to an issue you
   * opened should not list it twice across the dashboard.
   */
  myIssuesAssigned:
    'is:open is:issue assignee:@me -author:@me archived:false sort:updated-desc',
} as const
