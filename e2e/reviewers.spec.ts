import type { Route } from '@playwright/test'
import type { ReviewersPanel } from '../src/shared/types.js'
import { expect, test } from './fixtures.js'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for popover behavior')
})

const person = (login: string) => ({ login, name: null, avatarUrl: null })

const panel: ReviewersPanel = {
  reviewers: [{ ...person('carol'), isTeam: false, state: 'approved' }],
  candidates: [person('alice'), person('bob'), person('dave')],
  truncated: false,
  note: null,
}

test('reviewer edits run side by side without locking the list', async ({ board }) => {
  /** POSTs held open until the test lets them go. */
  const held: Route[] = []
  await board.route('**/api/pr/reviewers**', async (route) => {
    if (route.request().method() === 'POST') held.push(route)
    else await route.fulfill({ json: panel })
  })

  await board.locator('[data-card-action="reviewers"]').first().click()
  const popover = board.locator('[data-slot="popover-content"]')
  const candidate = (login: string) => popover.getByRole('option', { name: login })

  await candidate('alice').click()
  // The first request is still out; the rest of the list stays usable.
  await expect(candidate('bob')).toBeEnabled()
  await candidate('bob').click()
  await popover.getByRole('button', { name: 'Remove carol' }).click()

  await expect.poll(() => held.length).toBe(3)
  // All three show as done while GitHub has answered none of them.
  await expect(candidate('alice')).toHaveCount(0)
  await expect(candidate('bob')).toHaveCount(0)
  await expect(candidate('carol')).toBeVisible()
  await expect(popover.getByText('alice')).toBeVisible()

  for (const route of held) await route.fulfill({ json: { ok: true, message: 'ok' } })
})
