import { expect, pageOverflowsHorizontally, test } from './fixtures.js'

/* Runs at every size: whichever layout shows, the page itself never scrolls sideways. */

test('the page never scrolls sideways', async ({ board }) => {
  expect(await pageOverflowsHorizontally(board)).toBe(false)
})

test('narrow screens get the phone layout, wide ones the board', async ({ board }, info) => {
  const tabs = board.getByRole('tablist', { name: 'Columns' })
  if (info.project.name === 'desktop') {
    await expect(tabs).toHaveCount(0)
    // All six columns side by side, the first one's title in its header.
    await expect(board.getByRole('heading', { name: 'My pull requests' })).toBeVisible()
  } else {
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveCount(6)
  }
})

test('a title with one very long word wraps and keeps the buttons on the card', async ({ board }) => {
  const cards = board.locator('[data-slot=card]')
  await expect(cards.first()).toBeVisible()
  // Cards in columns scrolled out of view (phone tabs) have no box; skip them.
  const escapes = await cards.evaluateAll((els) =>
    els.flatMap((card) => {
      const box = card.getBoundingClientRect()
      if (box.width === 0) return []
      return [...card.querySelectorAll('button, a')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5))
        .map(() => card.textContent?.slice(0, 80) ?? '')
    }),
  )
  expect(escapes).toEqual([])
})
