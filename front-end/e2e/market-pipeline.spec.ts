import {
  test,
  expect,
  MarketSetupPage,
  AssignmentResultsPage,
  BACKEND_URL,
  TEST_USER,
} from './fixtures'
import { ensureTestOrg, loginViaApi, marketNameToSlug } from './helpers/seeds'
import { CheckinPage } from './pages/CheckinPage'

test.describe('Market pipeline E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
  })

  /**
   * Full end-to-end pipeline: create market via API, seed a setupObject,
   * walk the 3-page setup wizard, trigger assignment
   * generation, verify the results view, and publish the market with Done.
   */
  test('create market, configure, assign, view results, and publish', async ({
    authenticatedPage: page,
    playwright,
  }, testInfo) => {
    const marketName = `Pipeline E2E ${Date.now()}`

    // Phase 1: Create the market via API instead of CSV upload.
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
    const { market_id: marketId } = (await createRes.json()) as { market_id: string }

    // Upload source data so the assignment engine can compute assignments.
    // The solver reads from the source_data collection; without it, the
    // assignment on the setup wizard's Assign button returns 400.
    const csvContent = [
      'email,vendor_name,table_choice,buddy_email,day_1',
      'alice@example.com,Alice,Full table,,Gold',
      'bob@example.com,Bob,Full table,,Gold',
      'carol@example.com,Carol,Half Table,,Silver',
      'dave@example.com,Dave,Half Table,carol@example.com,Silver',
      'eve@example.com,Eve,Full table,,Gold',
    ].join('\n')
    const srcRes = await ctx.post(`${BACKEND_URL}/source-data/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
      multipart: {
        file: {
          name: 'vendors.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csvContent, 'utf-8'),
        },
      },
    })
    if (!srcRes.ok()) {
      throw new Error(`Source data upload failed: ${srcRes.status()} ${await srcRes.text()}`)
    }

    const marketRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    })
    let { market } = (await marketRes.json()) as { market: Record<string, unknown> }

    // Seed a minimal setupObject so the setup wizard has columns to display.
    const minimalSetup = {
      colNames: ['email', 'vendor_name', 'table_choice', 'buddy_email', 'day_1'],
      colValues: [[], [], [], [], ['Gold', 'Silver']],
      colInclude: [false, false, false, false, false],
      enumPriorityOrder: [[], [], [], [], []],
      priority: [],
      marketDates: [],
      tiers: [],
      locations: [],
      sections: [],
      assignmentOptions: {
        maxAssignmentsPerVendor: null,
        maxHalfTableProportionPerSection: null,
        emailColNameIdx: null,
        tableChoiceColNameIdx: null,
        tableShareEmailColNameIdx: null,
        maxDaysColNameIdx: null,
      },
    }
    const setupRes = await ctx.put(`${BACKEND_URL}/markets/${marketId}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Email': TEST_USER.email,
      },
      data: { ...market, setupObject: minimalSetup },
    })
    if (!setupRes.ok()) {
      throw new Error(`Setup PUT failed: ${setupRes.status()} ${await setupRes.text()}`)
    }
    const updatedRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    })
    const updated = (await updatedRes.json()) as { market: Record<string, unknown> }
    market = updated.market

    // Inject the market into localStorage so the setup wizard can pick it up.
    await page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m))
        localStorage.setItem('user', JSON.stringify(user))
      },
      { m: market, user: TEST_USER.email },
    )

    await page.goto('/market-setup')

    // Phase 2: Walk the setup wizard
    const setupPage = new MarketSetupPage(page)
    await setupPage.waitForWizard()

    // --- Page 0: Manage Columns + Market Dates ---
    await expect(page.locator('.double-column-body .setup-row').first()).toBeVisible({
      timeout: 5000,
    })
    const columnRows = page.locator('.double-column-body .setup-row')
    await expect(columnRows).toHaveCount(5)

    await setupPage.addMarketDate('2026-07-15', 4, 0)

    // Advance to page 1
    await setupPage.clickNext()

    // --- Page 1: Tiers + Locations + Sections ---
    await setupPage.selectManualPath()

    await expect(page.locator('.triple-column-body .priority-row').first()).toBeVisible({
      timeout: 5000,
    })

    // Add a location
    await setupPage.addLocation('Main Hall', 0)

    // Add a section: Gold tier, Main Hall location, 1 table
    await setupPage.addSection('Gold Tables', 'Main Hall', 'Gold', 1, 0)

    // Advance to page 2
    await setupPage.clickNext()

    // --- Page 2: Assignment Priority + Assignment Options ---
    await setupPage.selectEmailColumn(0)
    await setupPage.selectTableChoiceColumn(2)
    await setupPage.selectTableShareEmailColumn(3)

    await setupPage.setMaxAssignmentsPerVendor(1)
    await setupPage.setMaxHalfTableProportion(100)

    // Verify the Assign button is enabled and click it
    await setupPage.waitForAssignEnabled()
    await setupPage.clickAssign()

    // Phase 3: Verify assignment results
    const resultsPage = new AssignmentResultsPage(page)

    await expect(resultsPage.summaryStats).toBeVisible({ timeout: 15000 })

    const summaryText = await resultsPage.summaryStats.textContent()
    expect(summaryText).toContain('Assignments')
    expect(summaryText).toContain('Assigned Tables')
    expect(summaryText).toContain('Assigned Vendors')
    expect(summaryText).toContain('Satisfaction Score')

    await expect(resultsPage.doneButton).toBeVisible()
    await expect(resultsPage.downloadCsvButton).toBeVisible()
    await expect(resultsPage.backButton).toBeVisible()

    await expect(page.locator('.body-grid-date .stat-list')).toBeVisible()
    await expect(page.locator('.body-grid-section .stat-list')).toBeVisible()
    await expect(page.locator('.body-grid-tier .stat-list')).toBeVisible()

    await expect(resultsPage.viewVendorsButton).toBeVisible()
    await expect(resultsPage.viewTablesButton).toBeVisible()
    await expect(resultsPage.viewAttendanceButton).toBeVisible()

    // Phase 4: Publish with Done
    await page.screenshot({
      path: testInfo.outputPath('01-assignment-results-before-publish.png'),
      fullPage: true,
    })

    expect(marketId).toBeTruthy()

    await resultsPage.clickDone()

    // A published market lands on its public slug URL, not back in the wizard.
    const slug = marketNameToSlug(marketName)
    await page.waitForURL(`**/${slug}`, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Market home' })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('02-published-market-home.png'),
      fullPage: true,
    })

    // The server advanced the phase, and reports isDraft derived from it.
    const storedRes = await page.request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    })
    expect(storedRes.ok()).toBe(true)
    const { market: storedMarket } = (await storedRes.json()) as {
      market: { phase: string; isDraft: boolean }
    }
    expect(storedMarket.phase).toBe('archived')
    expect(storedMarket.isDraft).toBe(false)

    // Reopening the published market from the markets list routes on phase.
    await page.goto('/markets')
    await page
      .getByTestId('market-card')
      .filter({ hasText: marketName })
      .getByTestId('market-card-open-button')
      .click()
    await page.waitForURL(`**/${slug}`, { timeout: 10000 })

    // Phase 5: A vendor can now check in
    const anonymous = await playwright.request.newContext({ ignoreHTTPSErrors: true })
    const publicRes = await anonymous.get(
      `${BACKEND_URL}/public/markets/${slug}/vendors/${encodeURIComponent('alice@example.com')}/assignments`,
    )
    expect(publicRes.status()).toBe(200)
    await anonymous.dispose()

    // And the vendor-facing check-in page finds the assignment.
    const checkinPage = new CheckinPage(page)
    await checkinPage.goto(slug)
    await checkinPage.fillEmail('alice@example.com')
    await checkinPage.clickLookup()
    await expect(checkinPage.checkinButtons.first()).toBeVisible({ timeout: 10000 })
    await page.screenshot({
      path: testInfo.outputPath('03-checkin-after-publish.png'),
      fullPage: true,
    })
  })
})
