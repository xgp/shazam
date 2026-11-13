import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

/* Desktop-only: the phone layout has its own terminal screen, not the dock. */
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'the dock is desktop-only')
})

/** Every xterm rendered row sits inside its host - none clipped off the bottom. */
async function rowsFit(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.terminal-host')].map((host) => {
      const rows = host.querySelector('.xterm-rows')!.getBoundingClientRect()
      const box = host.getBoundingClientRect()
      return { rowsBottom: Math.round(rows.bottom), hostBottom: Math.round(box.bottom) }
    }),
  )
}

test('the terminal fits its rows inside the dock', async ({ board }) => {
  await board.locator('.terminal-host .xterm-rows').first().waitFor()
  await board.waitForTimeout(200)
  for (const { rowsBottom, hostBottom } of await rowsFit(board)) {
    expect(rowsBottom).toBeLessThanOrEqual(hostBottom)
  }
})

test('the dock moves to a resizable right-hand column and back', async ({ board }) => {
  await board.locator('.terminal-host').first().waitFor()
  await board.getByRole('button').filter({ has: board.locator('svg.lucide-panel-right') }).click()

  const host = board.locator('.terminal-host').first()
  // The session has a companion shell, so the column stacks two panes.
  await expect(board.locator('.terminal-host')).toHaveCount(2)
  const dock = host.locator('xpath=ancestor::div[contains(@class,"bg-card")][1]')
  const before = (await dock.boundingBox())!
  // Full height beside the board, against the right edge of the window.
  expect(before.x + before.width).toBeGreaterThan(1600 - 2)
  expect(before.height).toBeGreaterThan(800)
  await board.screenshot({ path: 'test-results/dock-right.png' })

  // Drag the column's left edge 200px further left.
  const edge = (await dock.boundingBox())!
  await board.mouse.move(edge.x, edge.y + 300)
  await board.mouse.down()
  await board.mouse.move(edge.x - 200, edge.y + 300, { steps: 5 })
  await board.mouse.up()
  const after = (await dock.boundingBox())!
  expect(Math.round(after.width - edge.width)).toBeGreaterThan(180)

  await board.waitForTimeout(200)
  for (const { rowsBottom, hostBottom } of await rowsFit(board)) {
    expect(rowsBottom).toBeLessThanOrEqual(hostBottom)
  }

  // Survives a reload, then goes back to the bottom.
  await board.reload()
  await board.locator('.terminal-host').first().waitFor()
  expect(Math.round((await dock.boundingBox())!.width)).toBe(Math.round(after.width))
  await board.getByRole('button').filter({ has: board.locator('svg.lucide-panel-bottom') }).click()
  expect((await dock.boundingBox())!.width).toBeGreaterThan(1500)
  await board.screenshot({ path: 'test-results/dock-bottom.png' })
})

test('owner chips cycle include, exclude, off', async ({ board }) => {
  const chip = board.locator('[data-slot="badge"]', { hasText: /^globex/ }).first()
  const cards = board.locator('[data-item-id]')
  const total = await cards.count()

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  const included = await cards.count()
  expect(included).toBeLessThan(total)

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'mixed')
  await expect(cards).toHaveCount(total - included)

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect(cards).toHaveCount(total)
})

test('PR cards show head → base', async ({ board }) => {
  const chip = board.getByTestId('branch-chip').first()
  await expect(chip).toHaveText(/feature-\d+\s*→\s*main/)
  await board.locator('[data-item-id]').first().screenshot({ path: 'test-results/branch-chip.png' })
})

test('card helpers sit left, merge/approve holds the right edge', async ({ board }) => {
  await board.getByRole('heading', { name: 'Waiting on my review' }).waitFor()
  for (const name of ['My pull requests', 'Waiting on my review']) {
    const card = board.locator('[data-item-id]', {
      has: board.getByRole('button', { name: name === 'My pull requests' ? /^Merge/ : /^Approve/ }),
    }).first()
    const cardBox = (await card.boundingBox())!
    const shazam = (await card.getByRole('button', { name: /Shazam/ }).first().boundingBox())!
    const finish = (await card.getByRole('button', { name: name === 'My pull requests' ? /^Merge/ : /^Approve/ }).first().boundingBox())!
    expect(shazam.x - cardBox.x).toBeLessThan(cardBox.width / 2)
    expect(cardBox.x + cardBox.width - (finish.x + finish.width)).toBeLessThan(60)
  }
  await board.screenshot({ path: 'test-results/actions-left.png' })
})
