import { test, expect, BACKEND_URL, TEST_USER, ApplicationFormPage } from './fixtures'
import { seedApplication } from './helpers/seedApplication'
import { ensureTestOrg, loginViaApi } from './helpers/seeds'
import type { Page } from '@playwright/test'

/** Create a bare market via the API and land on the setup view. Returns its id. */
async function createMarket(page: Page): Promise<string> {
  const ctx = page.request
  await loginViaApi(ctx, BACKEND_URL, TEST_USER.email, TEST_USER.password)
  const orgsRes = await ctx.get(`${BACKEND_URL}/organizations`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  })
  const orgs = (await orgsRes.json()).organizations as { id: string }[]
  const orgId = orgs[0]?.id
  if (!orgId) throw new Error('No organization found')

  const marketName = `Form Builder E2E ${Date.now()}`
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

  const marketRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  })
  const { market } = (await marketRes.json()) as { market: Record<string, unknown> }

  await page.evaluate(
    ({ m, user }) => {
      localStorage.setItem('market', JSON.stringify(m))
      localStorage.setItem('user', JSON.stringify(user))
    },
    { m: market, user: TEST_USER.email },
  )

  await page.goto('/market-setup')
  return marketId
}

test.describe('Application form builder', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
  })

  /**
   * The organizer's real journey: create a market (API, no CSV), open the
   * form builder tab, define the application fields in the draft phase, watch
   * the applicant preview follow along, save, and find the form still there
   * on reload.
   */
  test('organizer builds a form, previews it live, saves it, and it persists', async ({
    authenticatedPage: page,
  }, testInfo) => {
    const formPage = new ApplicationFormPage(page)
    await createMarket(page)

    // The Application Form tab starts empty
    await formPage.openFormTab()
    await expect(formPage.formTab).toHaveClass(/active/)
    await expect(formPage.builderEmpty).toBeVisible()
    await expect(formPage.previewEmpty).toBeVisible()
    await expect(formPage.saveButton).toBeDisabled()
    await expect(formPage.saveHint).toHaveText('Add at least one field to save this form.')
    await page.screenshot({
      path: testInfo.outputPath('01-empty-form-builder.png'),
      fullPage: true,
    })

    // Field 1: a required text field; the key auto-slugs from the label
    await formPage.addField()
    await formPage.fillLabel(0, 'Business Name')
    await expect(formPage.keyInput(0)).toHaveValue('business_name')
    await formPage.toggleRequired(0)
    await formPage.fillHelpText(0, 'The name shown on your table sign')

    // The preview follows every keystroke: label, required marker, help text.
    await expect(formPage.previewField('business_name')).toBeVisible()
    await expect(formPage.previewField('business_name')).toContainText('Business Name')
    await expect(formPage.previewField('business_name').locator('.preview-required')).toHaveText(
      '*',
    )
    await expect(formPage.previewField('business_name')).toContainText(
      'The name shown on your table sign',
    )

    // Field 2: a select with options
    await formPage.addField()
    await formPage.fillLabel(1, 'Table Size')
    await formPage.selectType(1, 'select')
    await formPage.addOption(1, 'Half Table')
    await formPage.addOption(1, 'Full Table')
    await expect(formPage.keyInput(1)).toHaveValue('table_size')
    await expect(formPage.previewField('table_size').locator('option')).toHaveText([
      '-- Select --',
      'Half Table',
      'Full Table',
    ])

    // Field 3: an email field, key hand-typed to override the slug
    await formPage.addField()
    await formPage.fillLabel(2, 'Contact Email')
    await formPage.selectType(2, 'email')
    await formPage.keyInput(2).fill('vendor_email')
    await formPage.fillLabel(2, 'Contact Email Address')
    await expect(formPage.keyInput(2)).toHaveValue('vendor_email')
    await expect(formPage.previewField('vendor_email')).toContainText('Contact Email Address')

    await page.screenshot({
      path: testInfo.outputPath('03-form-builder-with-preview.png'),
      fullPage: true,
    })

    // Save
    await expect(formPage.saveButton).toBeEnabled()
    await formPage.save()
    await expect(formPage.saveSuccess).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('04-form-saved.png'), fullPage: true })

    // It came from the server, not from local state
    await page.reload()
    await formPage.openFormTab()
    await expect(formPage.labelInput(0)).toHaveValue('Business Name')
    await expect(formPage.keyInput(1)).toHaveValue('table_size')
    await expect(formPage.keyInput(2)).toHaveValue('vendor_email')
    await expect(formPage.optionInputs(1).nth(0)).toHaveValue('Half Table')
    await expect(formPage.optionInputs(1).nth(1)).toHaveValue('Full Table')
    await expect(formPage.previewField('business_name')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('05-form-reloaded-from-server.png'),
      fullPage: true,
    })
  })

  /**
   * D9: once an applicant has submitted, the form is frozen for good. The builder says so
   * before the organizer touches anything, and the invariant is enforced on every route -
   * the application-form endpoint refuses with 409, and a market PUT cannot smuggle a new
   * form past it either.
   */
  test('an existing application locks the form in the builder and on every route', async ({
    authenticatedPage: page,
    playwright,
  }, testInfo) => {
    const formPage = new ApplicationFormPage(page)
    const marketId = await createMarket(page)

    // Build and save a form while the market is still applicant-free.
    await formPage.openFormTab()
    await formPage.addField()
    await formPage.fillLabel(0, 'Business Name')
    await formPage.save()
    await expect(formPage.saveSuccess).toBeVisible()

    // An applicant applies.
    seedApplication(marketId)

    // The builder reflects the lock before any edit is attempted
    await page.reload()
    await formPage.openFormTab()
    await expect(formPage.lockBanner).toBeVisible()
    await expect(formPage.lockBanner).toContainText('Application form is locked')
    await expect(formPage.lockBanner).toContainText('1 application(s) already exist')
    await expect(formPage.addFieldButton).toHaveCount(0)
    await expect(formPage.saveButton).toHaveCount(0)
    await expect(formPage.removeFieldButton(0)).toHaveCount(0)
    await expect(formPage.labelInput(0)).toBeDisabled()
    await expect(formPage.keyInput(0)).toBeDisabled()
    // The applicant preview still shows the form applicants are answering.
    await expect(formPage.previewField('business_name')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('06-form-locked-readonly.png'),
      fullPage: true,
    })

    // The lock is an invariant of the API, not a UI courtesy
    const api = await playwright.request.newContext({
      baseURL: BACKEND_URL,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'X-Owner-Email': TEST_USER.email },
    })
    await api.post('/login', { data: { email: TEST_USER.email, password: TEST_USER.password } })

    const tamperedForm = {
      fields: [
        { key: 'sneaky', label: 'Sneaky', type: 'text', required: false, options: [], order: 0 },
      ],
    }

    // The dedicated endpoint refuses with 409.
    const formPut = await api.put(`/markets/${marketId}/application-form`, { data: tamperedForm })
    expect(formPut.status()).toBe(409)
    expect((await formPut.json()).error).toContain('Application form is locked')

    // A market PUT carrying a rewritten form cannot bypass it either.
    const marketBefore = await (await api.get(`/markets/${marketId}`)).json()
    const marketPut = await api.put(`/markets/${marketId}`, {
      data: { ...marketBefore.market, applicationForm: tamperedForm },
    })
    expect(marketPut.ok()).toBeTruthy()

    // Whatever route was used, the stored form is still the one applicants see.
    const after = await (await api.get(`/markets/${marketId}/application-form`)).json()
    expect(after.editable).toBe(false)
    expect(after.lock_reason).toContain('Application form is locked')
    expect(after.application_form.fields).toHaveLength(1)
    expect(after.application_form.fields[0].key).toBe('business_name')

    await api.dispose()
  })
})
