import { dashboard, expect, stubServer, test } from './fixtures.js'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'board columns are desktop-only')
})

/*
 * A column that scrolls, holding a PR on a long branch: every card must still
 * fit inside its column rather than widening past it and clipping the
 * timestamp and the Merge button.
 */
test('cards never grow wider than their column', async ({ page, context }) => {
  await stubServer(context)
  const base = dashboard.columns.myPullRequests
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...base[i % base.length]!,
    id: `PR_wide_${i}`,
    number: 900 + i,
    headRef: i === 0 ? 'jp/hub-2026.1114.96-slack-replies-in-thread-whole-message-quoted' : `feature-${i}`,
  }))
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({ json: { ...dashboard, columns: { ...dashboard.columns, myPullRequests: many } } }),
  )
  await page.goto('/?t=test-token')
  await page.locator('[data-item-id="PR_wide_0"]').waitFor()

  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]')].flatMap((vp) => {
      const right = vp.getBoundingClientRect().right
      return [...vp.querySelectorAll<HTMLElement>('[data-item-id]')]
        .map((card) => Math.round(card.getBoundingClientRect().right - right))
        .filter((past) => past > 0)
    }),
  )
  await page.screenshot({ path: 'test-results/card-width.png' })
  expect(overflow).toEqual([])
})
