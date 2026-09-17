import { GraphqlResponseError } from '@octokit/graphql'
import {
  type MergeState,
  type PullRequestItem,
  mergeStateBlocks,
  reviewSatisfied,
} from '../../shared/types.js'
import { getGraphqlClient } from './client.js'

/**
 * Asked for separately, and only for the handful of PRs that could actually
 * merge. `mergeStateStatus` makes GitHub compute a trial merge for every pull
 * request in the response, and asking for it inside the dashboard query - a
 * hundred rows per column - reliably times the whole thing out with a 502 or
 * "we couldn't respond to your request in time".
 */
const MERGE_STATE_QUERY = /* GraphQL */ `
  query MergeStates($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequest {
        id
        mergeStateStatus
      }
    }
  }
`

/** GitHub's own ceiling for a single `nodes` lookup. */
const BATCH = 100

interface RawNode {
  id: string
  mergeStateStatus: string | null
}

function toMergeState(raw: string | null): MergeState {
  switch (raw) {
    case 'CLEAN':
      return 'clean'
    case 'UNSTABLE':
      return 'unstable'
    case 'HAS_HOOKS':
      return 'has_hooks'
    case 'BLOCKED':
      return 'blocked'
    case 'BEHIND':
      return 'behind'
    case 'DIRTY':
      return 'dirty'
    case 'DRAFT':
      return 'draft'
    default:
      return 'unknown'
  }
}

/**
 * Fills in `mergeState` for the pull requests whose Merge button is otherwise
 * live. It is what tells a red check that no rule requires - which GitHub
 * merges without complaint - from one that a branch rule does require, and
 * these two look identical in the check rollup.
 *
 * Anything we cannot find out stays `unknown`, which does not block: the field
 * is computed lazily, so a PR that is perfectly fine can answer UNKNOWN simply
 * because nobody has asked recently.
 */
export async function applyMergeStates(prs: PullRequestItem[]): Promise<void> {
  const candidates = prs.filter(
    (pr) =>
      pr.viewerCanMerge &&
      !pr.isDraft &&
      reviewSatisfied(pr.reviewDecision) &&
      pr.mergeable !== 'conflicting',
  )
  if (candidates.length === 0) return

  const byId = new Map(candidates.map((pr) => [pr.id, pr]))
  const ids = [...byId.keys()]
  const client = await getGraphqlClient()

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)

    let data: { nodes: (RawNode | null)[] }
    try {
      data = await client<{ nodes: (RawNode | null)[] }>(MERGE_STATE_QUERY, { ids: batch })
    } catch (err) {
      // One PR we cannot read must not cost us the state of the others.
      if (err instanceof GraphqlResponseError && err.data) {
        data = err.data as { nodes: (RawNode | null)[] }
      } else {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`shazam: merge states unavailable: ${message}`)
        return
      }
    }

    for (const node of data.nodes ?? []) {
      const pr = node?.id ? byId.get(node.id) : undefined
      if (!pr) continue
      pr.mergeState = toMergeState(node?.mergeStateStatus ?? null)
      pr.canMerge = !mergeStateBlocks(pr.mergeState)
    }
  }
}
