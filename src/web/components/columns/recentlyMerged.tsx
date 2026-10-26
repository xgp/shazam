import { MERGED_LOOKBACK_DAYS } from '../../../shared/types.js'
import { PrCard } from '../PrCard.js'
import type { ColumnDef } from '../registry.js'

export const recentlyMerged: ColumnDef = {
  id: 'recentlyMerged',
  title: 'Merged recently',
  // GitHub's own merged purple, so the column reads as done at a glance.
  dot: 'bg-violet-500',
  hint: `PRs you authored or merged in the last ${MERGED_LOOKBACK_DAYS} days, newest merge first`,
  empty: `Nothing merged in the last ${MERGED_LOOKBACK_DAYS} days.`,
  select: (data) => data.columns.recentlyMerged,
  renderItem: (item, ctx) =>
    item.kind === 'pull_request' ? (
      // Nothing left to act on: the card is a way back to the PR.
      <PrCard key={item.id} pr={item} ctx={ctx} action="none" />
    ) : null,
}
