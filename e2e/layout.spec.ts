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
