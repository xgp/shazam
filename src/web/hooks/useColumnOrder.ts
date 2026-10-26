import { useCallback, useState } from 'react'
import { COLUMNS } from '../components/columns/index.js'
import type { ColumnDef } from '../components/registry.js'

const ORDER_KEY = 'shazam.columnOrder'

/**
 * A saved order reconciled against the live registry: ids that no longer
 * exist drop out, and a column added since the order was saved slots in at
 * its default position rather than vanishing or piling up on the end.
 */
function reconcile(saved: unknown): ColumnDef[] {
  if (!Array.isArray(saved)) return COLUMNS
  const byId = new Map<string, ColumnDef>(COLUMNS.map((column) => [column.id, column]))
  const ordered: ColumnDef[] = []
  for (const id of saved) {
    const column = typeof id === 'string' ? byId.get(id) : undefined
    if (column && !ordered.includes(column)) ordered.push(column)
  }
  COLUMNS.forEach((column, index) => {
    if (!ordered.includes(column)) ordered.splice(Math.min(index, ordered.length), 0, column)
  })
  return ordered
}

function loadOrder(): ColumnDef[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    return raw ? reconcile(JSON.parse(raw)) : COLUMNS
  } catch {
    return COLUMNS
  }
}

function saveOrder(columns: ColumnDef[] | null): void {
  try {
    if (columns) localStorage.setItem(ORDER_KEY, JSON.stringify(columns.map((c) => c.id)))
    else localStorage.removeItem(ORDER_KEY)
  } catch {
    // storage disabled
  }
}

/**
 * The board's column order, a per-browser preference like collapse state.
 * COLUMNS stays the default; this only ever permutes it.
 */
export function useColumnOrder() {
  const [columns, setColumns] = useState<ColumnDef[]>(loadOrder)

  /** Puts `fromId` where `toId` is now, shifting the rest along. */
  const move = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setColumns((current) => {
      const from = current.findIndex((c) => c.id === fromId)
      const to = current.findIndex((c) => c.id === toId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (!moved) return current
      next.splice(to, 0, moved)
      saveOrder(next)
      return next
    })
  }, [])

  /** One step left (-1) or right (+1), for the keyboard. */
  const nudge = useCallback(
    (id: string, step: -1 | 1) => {
      const index = columns.findIndex((c) => c.id === id)
      const neighbour = columns[index + step]
      if (index >= 0 && neighbour) move(id, neighbour.id)
    },
    [columns, move],
  )

  const reset = useCallback(() => {
    saveOrder(null)
    setColumns(COLUMNS)
  }, [])

  const isCustom = columns.some((column, index) => column !== COLUMNS[index])

  return { columns, move, nudge, reset, isCustom }
}
