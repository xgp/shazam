import type { ColumnDef } from '../registry.js'
import { approvedPrs } from './approvedPrs.js'
import { assignedIssues } from './assignedIssues.js'
import { myIssues } from './myIssues.js'
import { myPullRequests } from './myPullRequests.js'
import { recentlyMerged } from './recentlyMerged.js'
import { reviewRequests } from './reviewRequests.js'

/**
 * The default order on screen. Each browser can drag its own (see
 * useColumnOrder), which only ever permutes this list.
 */
export const COLUMNS: ColumnDef[] = [
  myPullRequests,
  reviewRequests,
  approvedPrs,
  recentlyMerged,
  assignedIssues,
  myIssues,
]
