import { expect, test } from './fixtures.js'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'board-only controls')
})

const card = (board: import('@playwright/test').Page, title: string) =>
  board.locator('[data-item-id]', { hasText: title }).first()

test('an approved PR names its reviewer on the reviewers button', async ({ board }) => {
  const button = card(board, 'Dark mode for the invoice view').locator('[data-card-action="reviewers"]')
  await expect(button.getByRole('img', { name: 'carol' })).toBeVisible()
  await button.hover()
  await expect(board.getByRole('tooltip')).toContainText('carol approved')
  await board.screenshot({ path: 'test-results/review-tabs-board.png' })
})

test('Needs review keeps your own unapproved pull requests', async ({ board }) => {
  await board.getByRole('button', { name: 'Needs review' }).hover()
  await expect(board.getByRole('tooltip')).toContainText('nobody has approved')
  await board.getByRole('button', { name: 'Needs review' }).click()
  // octocat is the viewer and the fixtures' default author; the draft is left out.
  await expect(board.getByText('Docs: fuel table units').first()).toBeVisible()
  await expect(board.getByText('Short title')).toHaveCount(0)
  await expect(board.getByText('Idempotency keys for refunds')).toHaveCount(0)
  await board.screenshot({ path: 'test-results/review-tabs-needs.png' })
})

test('Ready to merge and Ready to approve sit beside All and filter the board', async ({ board }) => {
  await board.getByRole('button', { name: 'Ready to merge' }).click()
  await expect(board).toHaveURL(/q=is%3Amergeable/)
  // A draft, failing checks and pending checks are not ready to merge.
  await expect(board.getByText('Short title')).toHaveCount(0)
  await expect(board.getByText('Fix flaky clock test')).toHaveCount(0)
  await expect(board.getByText('Docs: fuel table units')).toHaveCount(0)
  await expect(board.getByText('Dark mode for the invoice view').first()).toBeVisible()

  await board.getByRole('button', { name: 'Ready to approve' }).click()
  // Changes requested is not ready to approve.
  await expect(board.getByText('Bump node to 22')).toHaveCount(0)
  await expect(board.getByText('Idempotency keys for refunds').first()).toBeVisible()
  await board.screenshot({ path: 'test-results/review-tabs-approve.png' })
})
