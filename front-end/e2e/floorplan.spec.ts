import path from 'path'
import { fileURLToPath } from 'url'
import {
  test,
  expect,
  MarketSetupPage,
  FloorplanWorkflowPage,
  BACKEND_URL,
  TEST_USER,
} from './fixtures'
import { ensureTestOrg, loginViaApi } from './helpers/seeds'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png')

/**
 * Parsed CSV data matching fixtures/test-vendors.csv, built by hand so the
 * floorplan spec does not need to upload a CSV through the overlay.
 */
function fakeUploadObject() {
  return {
    name: 'test-vendors.csv',
    size: 123,
    type: 'text/csv',
    lastModified: Date.now(),
    data: {
      data: [
        {
          email: 'alice@example.com',
          vendor_name: 'Alice',
          table_choice: 'Full table',
          buddy_email: '',
          day_1: 'Gold',
        },
        {
          email: 'bob@example.com',
          vendor_name: 'Bob',
          table_choice: 'Full table',
          buddy_email: '',
          day_1: 'Gold',
        },
        {
          email: 'carol@example.com',
          vendor_name: 'Carol',
          table_choice: 'Half Table',
          buddy_email: '',
          day_1: 'Silver',
        },
        {
          email: 'dave@example.com',
          vendor_name: 'Dave',
          table_choice: 'Half Table',
          buddy_email: 'carol@example.com',
          day_1: 'Silver',
        },
        {
          email: 'eve@example.com',
          vendor_name: 'Eve',
          table_choice: 'Full table',
          buddy_email: '',
          day_1: 'Gold',
        },
      ],
      errors: [],
      meta: {
        fields: ['email', 'vendor_name', 'table_choice', 'buddy_email', 'day_1'],
      },
    },
  }
}

test.describe('Floorplan workflow E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
  })

  test('create market from floorplan, complete wizard, and verify save', async ({
    authenticatedPage: page,
  }) => {
    const marketName = `Floorplan E2E ${Date.now()}`

    // Create the market via API instead of CSV upload through the UI overlay.
    const ctx = page.request
    await loginViaApi(ctx, BACKEND_URL, TEST_USER.email, TEST_USER.password)
    const orgsRes = await ctx.get(`${BACKEND_URL}/organizations`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    })
    const orgs = (await orgsRes.json()).organizations as { id: string }[]
    const orgId = orgs[0]?.id
    if (!orgId) throw new Error('No organization found')

    const createRes = await ctx.post(`${BACKEND_URL}/markets`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Email': TEST_USER.email,
      },
      data: {
        name: marketName,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    })
    if (!createRes.ok()) {
      throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`)
    }

    const marketRes = await ctx.get(
      `${BACKEND_URL}/markets/${(await createRes.json()).market_id}`,
      { headers: { 'X-Owner-Email': TEST_USER.email } },
    )
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> }

    // Inject the market + pseudo-upload into localStorage so the setup wizard
    // has columns to display without a real CSV upload.
    await page.evaluate(
      ({ m, upload, user }) => {
        localStorage.setItem('market', JSON.stringify(m))
        localStorage.setItem('upload', JSON.stringify(upload))
        localStorage.setItem('user', JSON.stringify(user))
      },
      { m: market, upload: fakeUploadObject(), user: TEST_USER.email },
    )

    await page.goto('/market-setup')

    const setupPage = new MarketSetupPage(page)
    await setupPage.waitForWizard()

    await expect(page.locator('.double-column-body .setup-row').first()).toBeVisible({
      timeout: 5000,
    })
    await setupPage.addMarketDate('2026-07-15', 4, 0)
    await setupPage.clickNext()

    const floorplanPage = new FloorplanWorkflowPage(page)
    await floorplanPage.selectFloorplanPath()
    await floorplanPage.completeFloorplanWorkflow(FLOORPLAN_PATH)

    await expect(page).toHaveURL(/\/market-setup/)
    await setupPage.waitForWizard()

    // Verify placed tables survived the step-2 to step-3 transition.
    // If the initFloorplan bug resets placedTables, this fails.
    const survivingTables = await floorplanPage.snapshotPlacedTables()
    expect(survivingTables.length).toBeGreaterThan(0)

    const sectionsContainer = page.locator('.triple-column-body')
    await sectionsContainer.waitFor({ state: 'visible', timeout: 5000 })
    const sectionRows = page.locator('.triple-column-body .priority-row')
    await expect(sectionRows.first()).toBeVisible({ timeout: 10000 })
  })
})
