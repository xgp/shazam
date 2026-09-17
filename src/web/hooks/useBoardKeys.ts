import { useEffect } from 'react'

/** The cursor only needs to know where a card is and where it leads. */
export interface BoardCursorItem {
  id: string
  url: string
}

/** A rendered column: only visible cards, and none at all when collapsed. */
export interface BoardCursorColumn {
  columnId: string
  items: BoardCursorItem[]
}

/**
 * Single keys that press a control on the selected card. The handler clicks
 * the card's own button (found by data-card-action) instead of threading
 * state up here, so every dialog, popover, and busy state keeps living in the
 * component that owns it.
 */
const ACTION_KEYS: Record<string, string> = {
  r: 'reviewers',
  s: 'shazam',
  m: 'merge',
  a: 'approve',
  c: 'close',
}

const scrollToCard = (id: string) => {
  // The card is already in the DOM - only its ring changes on the next
  // render - so scrolling now is safe. inline too: the board scrolls
  // sideways, and the cursor crosses column boundaries.
  document
    .querySelector(`[data-item-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/**
 * Keyboard cursor over the visible cards: j/k walk every card in reading
 * order, the arrows treat the board as the 2D grid it looks like, Enter/o
 * open the selection, and r/s/m/a/c press the selected card's own action
 * buttons. There is no separate "keyboard selection" state: the
 * cursor IS lastClickedId, so a click and a keypress move the same marker and
 * the card shows the same ring either way - two selection mechanisms fighting
 * over two highlights would be worse than sharing one.
 */
export function useBoardKeys(
  columns: BoardCursorColumn[],
  selectedId: string | null,
  onSelect: (id: string) => void,
) {
  useEffect(() => {
    // j/k deliberately keep the flat reading order and cross column
    // boundaries; the arrows below are the column-aware way around.
    const items = columns.flatMap((column) => column.items)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key
      const isArrow =
        key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowLeft' || key === 'ArrowRight'
      const action = ACTION_KEYS[key]
      if (key !== 'j' && key !== 'k' && key !== 'o' && key !== 'Enter' && !isArrow && !action) {
        return
      }
      // Same guard the FilterBar uses for '/': leave keys alone while the user
      // is typing - the filter box, a comment box, a rename field, or the
      // terminal (xterm types into a hidden textarea; the class check covers
      // its canvas too).
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"], .xterm')) return
      // Enter on a focused button or link is activating that control, not
      // asking to open the selected card on top of it.
      if (key === 'Enter' && target?.closest('a, button, [role="menuitem"]')) return

      if (action) {
        if (!selectedId) return
        const control = document.querySelector(
          `[data-item-id="${CSS.escape(selectedId)}"] [data-card-action="${action}"]`,
        )
        // A control the card does not have (issue cards carry no Merge, PR
        // cards no Close) or one that is disabled (blocked, busy) makes the
        // key a silent no-op - never a throw, never a press somewhere else.
        if (!(control instanceof HTMLElement)) return
        if (control instanceof HTMLButtonElement && control.disabled) return
        event.preventDefault()
        control.click()
        return
      }

      if (items.length === 0) return

      if (key === 'j' || key === 'k') {
        const index = selectedId ? items.findIndex((item) => item.id === selectedId) : -1
        // No selection yet (or it was filtered away): j starts at the top,
        // k at the bottom, so the first press always lands somewhere sensible.
        const next =
          index === -1
            ? key === 'j'
              ? 0
              : items.length - 1
            : Math.min(items.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))
        const item = items[next]
        if (!item || item.id === selectedId) return
        event.preventDefault()
        onSelect(item.id)
        scrollToCard(item.id)
        return
      }

      if (isArrow) {
        // preventDefault even when the cursor cannot move: a handled arrow
        // must never fall through and scroll the board out from under it.
        event.preventDefault()
        const columnIndex = selectedId
          ? columns.findIndex((column) => column.items.some((item) => item.id === selectedId))
          : -1

        if (columnIndex === -1) {
          // No selection yet (or it was filtered away): Down and Right both
          // land on the first card of the first non-empty column, so the
          // arrows always have a way in. Up and Left have no natural start.
          if (key !== 'ArrowDown' && key !== 'ArrowRight') return
          const first = columns.find((column) => column.items.length > 0)?.items[0]
          if (!first) return
          onSelect(first.id)
          scrollToCard(first.id)
          return
        }

        const column = columns[columnIndex]
        if (!column) return
        const rowIndex = column.items.findIndex((item) => item.id === selectedId)

        let next: BoardCursorItem | undefined
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          // Within the column, stopping at the ends: wrapping around would
          // make "which card is next" depend on where the list ends.
          const row = Math.min(
            column.items.length - 1,
            Math.max(0, rowIndex + (key === 'ArrowDown' ? 1 : -1)),
          )
          next = column.items[row]
        } else {
          // Sideways: the nearest non-empty column, holding the row and
          // clamping where the neighbor is shorter.
          const step = key === 'ArrowRight' ? 1 : -1
          for (let i = columnIndex + step; i >= 0 && i < columns.length; i += step) {
            const neighbor = columns[i]
            if (neighbor && neighbor.items.length > 0) {
              next = neighbor.items[Math.min(rowIndex, neighbor.items.length - 1)]
              break
            }
          }
        }

        if (!next || next.id === selectedId) return
        onSelect(next.id)
        scrollToCard(next.id)
        return
      }

      const selected = selectedId ? items.find((item) => item.id === selectedId) : undefined
      if (!selected) return
      event.preventDefault()
      window.open(selected.url, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [columns, selectedId, onSelect])
}
