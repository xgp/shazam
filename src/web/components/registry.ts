import type { ReactNode } from 'react'
import type {
  AgentId,
  AgentSession,
  ColumnId,
  DashboardData,
  DashboardItem,
  HealthReport,
  MergeMethod,
} from '../../shared/types.js'

/** Everything a column needs from the app shell to render its rows. */
export interface ColumnContext {
  viewer: string
  agents: HealthReport['agents']
  /** Merge method the primary Merge click uses without asking. */
  defaultMergeMethod: MergeMethod
  /** Agent a plain Shazam click opens, from config. */
  defaultAgent: AgentId
  /** Live agent sessions keyed by the dashboard row each was launched from. */
  sessionsByItem: Map<string, AgentSession>
  /** Brings the dock to a session's tab and expands it. */
  onRevealSession: (sessionId: string) => void
  onSessionLaunched: (session: AgentSession) => void
  /**
   * Called with the item's id after an action that changes GitHub state. It
   * refreshes and hides the row, which a refresh alone cannot always do.
   */
  onActioned: (itemId: string) => void
  /**
   * Refresh without hiding the row, for a change that alters a tile rather
   * than removing it - requesting a review, say, which flips the PR's review
   * decision but leaves it exactly where it was.
   */
  onChanged: () => void
  /** Item id of the tile touched most recently, marked across all columns. */
  lastClickedId: string | null
  /** Any click anywhere inside a tile reports it, buttons and chips included. */
  onTileClicked: (id: string) => void
}

/**
 * A column is the unit of swappability. Adding, removing or reordering a list
 * on the dashboard is an edit to COLUMNS below - the shell knows nothing about
 * what any particular column contains.
 */
export interface ColumnDef {
  id: ColumnId
  title: string
  hint: string
  empty: string
  /**
   * Tailwind bg-* class for the little status dot in the column header, so a
   * glance at the board separates the columns the way GitHub Projects does.
   * Optional: a column without one simply renders no dot.
   */
  dot?: string
  select: (data: DashboardData) => DashboardItem[]
  renderItem: (item: DashboardItem, ctx: ColumnContext) => ReactNode
}

export const ownerOf = (item: DashboardItem): string => item.repo.owner
