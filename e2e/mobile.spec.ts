import type { Page } from '@playwright/test'
import { dashboard, expect, pageOverflowsHorizontally, test } from './fixtures.js'

/* The phone layout: everything below 768px wide. */

test.beforeEach(({}, info) => {
  test.skip(info.project.name === 'desktop', 'phone layout only')
})

const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Columns' }).getByRole('tab', { name: new RegExp(`^${name}`) })

const firstPr = dashboard.columns.myPullRequests[0]!
const waitingTitle = `${firstPr.repo.nameWithOwner}#${firstPr.number}`

async function openTerminal(page: Page) {
  await page.getByRole('button', { name: /is waiting for you/ }).click()
  await expect(page.locator('[data-mobile-terminal]')).toBeVisible()
  await expect(page.locator('[data-mobile-terminal] .xterm')).toBeVisible()
}

test.describe('board', () => {
  test('tapping a tab swipes to that column', async ({ board }) => {
    await tab(board, 'Waiting on my review').click()
    await expect(tab(board, 'Waiting on my review')).toHaveAttribute('aria-selected', 'true')
    await expect(board.getByText('Idempotency keys for refunds')).toBeInViewport()
  })

  test('swiping the pager moves the tab strip along', async ({ board }) => {
    await board.locator('.snap-x').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 }))
    await expect(tab(board, 'Approved, awaiting merge')).toHaveAttribute('aria-selected', 'true')
  })

  test('owner filter folds away and still filters', async ({ board }) => {
    await expect(board.getByText('Owners')).toHaveCount(0)
    await board.getByRole('button', { name: 'Filters and views' }).click()
    await board.locator('[data-slot="badge"]', { hasText: /^globex\d/ }).click()
    // Nothing in My pull requests belongs to globex.
    await expect(tab(board, 'My pull requests')).toContainText('0')
    await expect(tab(board, 'Waiting on my review')).toContainText('2')
  })

  test('the menu carries what desktop tooltips would, and reorders columns', async ({ board }) => {
    await board.getByRole('button', { name: 'Menu', exact: true }).click()
    await expect(board.getByText(/^Updated /)).toBeVisible()
    await expect(board.getByText(/GitHub API: 4870 of 5000 left/)).toBeVisible()
    await board.getByRole('menuitem', { name: 'Reorder columns' }).click()
    await board.getByRole('button', { name: 'Move Waiting on my review up' }).click()
    await board.keyboard.press('Escape')
    await expect(
      board.getByRole('tablist', { name: 'Columns' }).getByRole('tab').first(),
    ).toContainText('Waiting on my review')
  })

  test('a phone held sideways keeps one search box and drops the hints', async ({ board }, info) => {
    test.skip(info.project.name !== 'phone-landscape', 'landscape only')
    await expect(board.getByRole('textbox', { name: 'Filter items' }).filter({ visible: true })).toHaveCount(1)
    await expect(board.getByText('Open PRs you authored', { exact: false })).toBeHidden()
  })

  test('a tap on a status chip explains it', async ({ board }, info) => {
    test.skip(!info.project.use.hasTouch, 'touch only')
    // The review chip has no link of its own, so its meaning is all tooltip.
    const chip = board.locator('[data-item-id]').first().locator('[data-slot="tooltip-trigger"]').filter({
      has: board.locator('svg.lucide-user-search'),
    })
    await chip.tap()
    await expect(board.getByRole('tooltip')).toContainText('Review required')
  })
})

test.describe('terminal', () => {
  test('the session bar names the waiting session and opens it full screen', async ({ board }) => {
    await expect(board.getByRole('button', { name: /is waiting for you/ })).toContainText(waitingTitle)
    await openTerminal(board)
    expect(await pageOverflowsHorizontally(board)).toBe(false)
  })

  test("a card's session badge opens that session", async ({ board }) => {
    await board.locator(`[data-item-id="${firstPr.id}"]`).getByRole('button', { name: /claude session/ }).click()
    await expect(board.locator('[data-mobile-terminal]')).toBeVisible()
    await expect(board.getByRole('button', { name: 'Session menu' })).toContainText(waitingTitle)
  })

  test('the key bar sends the keys a phone keyboard lacks', async ({ board, pty }) => {
    await openTerminal(board)
    const bar = board.locator('[data-mobile-terminal]')
    await bar.getByRole('button', { name: 'Escape' }).click()
    await bar.getByRole('button', { name: 'Shift Tab' }).click()
    await bar.getByRole('button', { name: 'Up' }).click()
    await expect
      .poll(() => (pty.get('session-1') ?? []).filter((m) => m.type === 'input').map((m) => m.data))
      .toEqual(['\x1b', '\x1b[Z', '\x1b[A'])
  })

  test('sticky ctrl turns the next typed letter into a control key', async ({ board, pty }) => {
    await openTerminal(board)
    await board.getByRole('button', { name: 'Control (applies to the next key)' }).click()
    await board.locator('[data-mobile-terminal] .xterm').click()
    await board.keyboard.type('cx')
    await expect
      .poll(() => (pty.get('session-1') ?? []).filter((m) => m.type === 'input').map((m) => m.data))
      .toEqual(['\x03', 'x'])
  })

  test('the compose box sends text, then Enter separately', async ({ board, pty }) => {
    await openTerminal(board)
    await board.getByRole('button', { name: 'Compose a message' }).click()
    await board.getByRole('textbox', { name: 'Message to send' }).fill('run the tests')
    await board.getByRole('textbox', { name: 'Message to send' }).press('Enter')
    await expect
      .poll(() => (pty.get('session-1') ?? []).filter((m) => m.type === 'input').map((m) => m.data))
      .toEqual(['run the tests', '\r'])
  })

  test('agent and shell are a toggle, each on its own socket', async ({ board, pty }) => {
    await openTerminal(board)
    await board.locator('[data-mobile-terminal]').getByRole('button', { name: 'shell', exact: true }).click()
    await expect.poll(() => pty.has('shell-1')).toBe(true)
  })

  test('the back gesture leaves the terminal, not shazam', async ({ board }) => {
    await openTerminal(board)
    await board.goBack()
    await expect(board.locator('[data-mobile-terminal]')).toHaveCount(0)
    await expect(board.getByRole('tablist', { name: 'Columns' })).toBeVisible()
  })

  test('with the keyboard up, the key bar stays on screen', async ({ board }) => {
    await openTerminal(board)
    const width = board.viewportSize()!.width
    // A soft keyboard shrinks the visual viewport; resizing is the nearest a
    // desktop browser gets.
    await board.setViewportSize({ width, height: 300 })
    await expect(board.getByRole('button', { name: 'Enter', exact: true })).toBeInViewport()
  })

  test('show on board closes the terminal and lands on the card', async ({ board }) => {
    await tab(board, 'Merged recently').click()
    await openTerminal(board)
    await board.getByRole('button', { name: 'Session menu' }).click()
    await board.getByRole('menuitem', { name: /on the board/ }).click()
    await expect(board.locator('[data-mobile-terminal]')).toHaveCount(0)
    await expect(board.locator(`[data-item-id="${firstPr.id}"]`)).toBeInViewport()
    await expect(tab(board, 'My pull requests')).toHaveAttribute('aria-selected', 'true')
  })
})
