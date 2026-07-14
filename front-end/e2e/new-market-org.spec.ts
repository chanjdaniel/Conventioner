import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect, LoginPage, NewMarketPage, BACKEND_URL, TEST_USER } from './fixtures'
import { ensureTestOrg, loginViaApi } from './helpers/seeds'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_PATH = path.resolve(__dirname, 'fixtures', 'test-vendors.csv')

/**
 * Verified user that deliberately belongs to no organization.
 * Created by scripts/seed_fixture.sh alongside TEST_USER.
 */
const NO_ORG_USER = {
  email: 'e2e-noorg@example.com',
  password: 'e2enoorg123',
}

/**
 * D14: every market requires an organization at creation. An org-less market is
 * not a valid state, so the overlay must block submission until one is picked,
 * and a user with no organizations must be routed to create one first.
 */
test.describe('New market - organization is required', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
  })

  test('org picker gates submission and the created market carries the org', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
    const orgsRes = await request.get(`${BACKEND_URL}/organizations`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    })
    expect(orgsRes.ok()).toBe(true)
    const orgs = (await orgsRes.json()).organizations as { id: string; name: string }[]
    expect(orgs.length).toBeGreaterThan(0)

    const newMarketPage = new NewMarketPage(page)
    const marketName = `Org Required E2E ${Date.now()}`

    await page.goto('/markets')
    await page.getByTestId('markets-create-button').click()
    await newMarketPage.waitForOverlay()
    await newMarketPage.uploadCsv(CSV_PATH)
    await newMarketPage.waitForNameInput()

    // The dropdown offers exactly the organizations GET /organizations returns.
    expect((await newMarketPage.orgOptionLabels()).sort()).toEqual(orgs.map((o) => o.name).sort())

    // Nothing selected yet, so the market cannot be created.
    await expect(newMarketPage.orgSelect).toHaveValue('')
    await expect(newMarketPage.submitButton).toBeDisabled()
    await newMarketPage.fillMarketName(marketName)
    await expect(newMarketPage.submitButton).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('01-submit-blocked-no-org.png') })

    // Picking an organization unlocks submission.
    await newMarketPage.selectFirstOrg()
    await expect(newMarketPage.submitButton).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('02-org-selected-submit-enabled.png') })

    const selectedOrgId = await newMarketPage.orgSelect.inputValue()
    expect(orgs.map((o) => o.id)).toContain(selectedOrgId)

    await newMarketPage.clickSubmit()
    await newMarketPage.waitForSetupRedirect()

    // CSV must have been parsed — a silent failure is data-loss, not a pass.
    const uploadData = await page.evaluate(() => {
      const stored = localStorage.getItem('upload')
      return stored ? JSON.parse(stored) : null
    })
    expect(uploadData, 'CSV parse result must be stored in localStorage').toBeTruthy()
    expect(uploadData?.data?.data, 'PapaParse rows must be present').toBeTruthy()
    expect(uploadData.data.data.length, 'Must have parsed CSV rows').toBeGreaterThan(0)

    // The persisted market is stamped with the organization that was chosen.
    const marketsRes = await request.get(`${BACKEND_URL}/markets`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    })
    expect(marketsRes.ok()).toBe(true)
    const markets = (await marketsRes.json()).markets as { name: string; organizationId?: string }[]
    const created = markets.find((m) => m.name === marketName)
    expect(created).toBeTruthy()
    expect(created?.organizationId).toBe(selectedOrgId)
  })

  test('a user with no organizations is pointed at organization creation', async ({
    page,
  }, testInfo) => {
    const loginPage = new LoginPage(page)
    await loginPage.login(NO_ORG_USER.email, NO_ORG_USER.password)
    await loginPage.waitForDashboardRedirect()

    const newMarketPage = new NewMarketPage(page)
    await page.goto('/markets')
    await page.getByTestId('markets-create-button').click()
    await newMarketPage.waitForOverlay()
    await newMarketPage.uploadCsv(CSV_PATH)
    await newMarketPage.waitForNameInput()

    await expect(newMarketPage.orgEmptyHint).toBeVisible()
    await expect(newMarketPage.orgSelect).toBeDisabled()
    await expect(newMarketPage.submitButton).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('03-zero-org-fallback.png') })

    await newMarketPage.orgCreateLink.click()
    await expect(page).toHaveURL(/\/organizations/)
  })
})
