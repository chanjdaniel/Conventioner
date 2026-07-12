import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect, MarketSetupPage, NewMarketPage, FloorplanWorkflowPage, BACKEND_URL, TEST_USER } from './fixtures'
import { ensureTestOrg } from './helpers/seeds'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png')
const CSV_PATH = path.resolve(__dirname, 'fixtures', 'test-vendors.csv')

test.describe('Floorplan workflow E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
  })

  test('create market from floorplan, complete wizard, and verify save', async ({
    authenticatedPage: page,
  }) => {
    const marketName = `Floorplan E2E ${Date.now()}`

    const newMarketPage = new NewMarketPage(page)
    await page.goto('/markets')
    await page.getByTestId('markets-create-button').click()
    await newMarketPage.waitForOverlay()
    await newMarketPage.uploadCsv(CSV_PATH)
    await newMarketPage.waitForNameInput()
    await newMarketPage.selectFirstOrg()
    await newMarketPage.fillMarketName(marketName)
    await newMarketPage.clickSubmit()
    await newMarketPage.waitForSetupRedirect()

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
