import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage } from './fixtures';
import { APPLICATION_FIELDS, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * The form builder asks before unsaved questions are dropped (T271).
 *
 * The questions an organizer writes live in the open tab until Save Form, and opening Plan, a link
 * or Back dropped them with no word. "Open applications" over them opened the form as last saved,
 * so applicants got a form without its last questions, and ticking an essential's "Ask this" saved
 * whatever questions were in hand, without Save Form's checks.
 */

const LABEL = 'Booth theme';
const SENTENCE = "Your changes to the form's questions are not saved. Leaving drops them.";

/** A draft whose vendors apply on its page, its form and review setup ready to open applications. */
async function seedReadyDraft(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { draft: true },
  );
  return marketId;
}

/** The labels of the questions the server holds. */
async function storedLabels(request: APIRequestContext, marketId: string): Promise<string[]> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}/application-form`);
  const { application_form: form } = (await res.json()) as {
    application_form: { fields: { label: string }[] } | null;
  };
  return (form?.fields ?? []).map((field) => field.label);
}

/** Open the form's questions and write one more, leaving it unsaved. */
async function addAQuestion(page: Page): Promise<void> {
  await page.getByTestId('form-step-questions').click();
  await page.getByTestId('form-builder-add-field-button').click();
  await page.getByTestId('form-field-label-input').last().fill(LABEL);
}

const question = (page: Page) => page.getByTestId('unsaved-work-window');

test.describe('Unsaved questions ask before they are dropped', () => {
  test('another tab asks first; Stay, Escape, the close and the scrim keep the question, Leave drops it', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const marketId = await seedReadyDraft(request);
    await page.goto(marketSetupPath(marketId, 'form'));
    await addAQuestion(page);
    const formPath = new URL(page.url()).pathname;

    const planTab = page.getByTestId('market-bar-tab-setup');
    await planTab.click();
    await expect(question(page)).toBeVisible();
    await expect(question(page)).toHaveAccessibleName('Leave without saving?');
    await expect(page.getByTestId('unsaved-work-sentence')).toHaveText(SENTENCE);
    // Leave drops the work, so the question opens on Stay.
    await expect(page.getByTestId('unsaved-work-cancel-button')).toBeFocused();
    await expectAccessible('the leave question over the form');

    // Every way of closing the question but Leave is Stay.
    const stays = async (how: string, close: () => Promise<void>) => {
      await close();
      await expect(question(page), `${how} closes the question`).toBeHidden();
      expect(new URL(page.url()).pathname).toBe(formPath);
      await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(LABEL);
    };
    await stays('Stay', () => page.getByTestId('unsaved-work-cancel-button').click());
    await expect(planTab).toBeFocused();
    await planTab.click();
    await stays('Escape', () => page.keyboard.press('Escape'));
    await planTab.click();
    await stays('The close', () => page.getByTestId('unsaved-work-close-button').click());
    await planTab.click();
    await stays('The scrim', () =>
      page.getByTestId('unsaved-work-background').click({ position: { x: 4, y: 4 } }),
    );

    await planTab.click();
    await page.getByTestId('unsaved-work-submit-button').click();
    await expect(page).toHaveURL(new RegExp(`${marketSetupPath(marketId, 'setup')}$`));
    await expect(question(page)).toBeHidden();
    expect(await storedLabels(request, marketId)).not.toContain(LABEL);

    // Back on the form, the dropped question is gone and nothing is unsaved, so nothing asks.
    await page.getByTestId('market-bar-tab-form').click();
    await page.getByTestId('form-step-questions').click();
    await expect(page.getByTestId('form-field-label-input')).toHaveCount(APPLICATION_FIELDS.length);
    await planTab.click();
    await expect(page).toHaveURL(new RegExp(`${marketSetupPath(marketId, 'setup')}$`));
    await expect(question(page)).toBeHidden();
  });

  test("the form's steps and a saved form never ask, and Back does", async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedReadyDraft(request);
    await page.goto(marketSetupPath(marketId, 'setup'));
    await page.getByTestId('market-bar-tab-form').click();
    await addAQuestion(page);

    // The steps are one working copy: moving between them changes only the address's `?step=`.
    await page.getByTestId('form-step-preview').click();
    await page.getByTestId('form-step-essentials').click();
    await page.getByTestId('form-step-review').click();
    await page.getByTestId('form-step-questions').click();
    await expect(question(page)).toBeHidden();
    await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(LABEL);

    // Back asks as a tab does.
    await page.goBack({ waitUntil: 'commit' });
    await expect(question(page)).toBeVisible();
    await page.getByTestId('unsaved-work-cancel-button').click();
    await expect(page).toHaveURL(/\/form\?step=questions$/);
    await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(LABEL);

    // Saved, the form holds nothing to lose.
    await page.getByTestId('form-builder-save-button').click();
    await expect(page.getByTestId('form-builder-save-success')).toBeVisible();
    expect(await storedLabels(request, marketId)).toContain(LABEL);
    await page.getByTestId('market-bar-tab-setup').click();
    await expect(page).toHaveURL(new RegExp(`${marketSetupPath(marketId, 'setup')}$`));
    await expect(question(page)).toBeHidden();
  });

  test('a reload with unsaved questions is asked by the browser, and a saved form is not', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedReadyDraft(request);
    await page.goto(marketSetupPath(marketId, 'form'));
    await addAQuestion(page);

    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.type());
      void dialog.accept();
    });
    await page.reload();
    await expect(page.getByTestId('form-step-questions')).toBeVisible();
    expect(asked).toEqual(['beforeunload']);
    expect(await storedLabels(request, marketId)).not.toContain(LABEL);

    // Nothing unsaved: the browser does not ask.
    await page.reload();
    await expect(page.getByTestId('form-step-questions')).toBeVisible();
    expect(asked).toEqual(['beforeunload']);
  });

  test('Sign out never stops on the question', async ({ authenticatedPage: page, request }) => {
    const marketId = await seedReadyDraft(request);
    await page.goto(marketSetupPath(marketId, 'form'));
    await addAQuestion(page);

    await page.getByTestId('app-bar-account-button').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(question(page)).toBeHidden();
  });

  test('a move refuses over unsaved questions, and says to Save Form first', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedReadyDraft(request);
    const moves: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith(`/markets/${marketId}/transition`)) {
        moves.push(req.url());
      }
    });
    await page.goto(marketSetupPath(marketId, 'form'));
    await addAQuestion(page);

    const setup = new MarketSetupPage(page);
    await setup.clickTransition('applications');
    const error = page.getByTestId('phase-rail-error');
    const opening = page.getByTestId('open-applications-submit-button');
    await opening.or(error).first().waitFor();
    if (await opening.isVisible()) await opening.click();

    await expect(error).toHaveText(
      'The market did not move: the form has changes that are not saved. Save Form first.',
    );
    await expect(page.getByTestId('phase-rail-current')).toHaveText(/Draft/);
    expect(moves).toEqual([]);
    await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(LABEL);
  });

  test('ticking "Ask this" saves only that choice, never an unsaved question', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedReadyDraft(request);
    await page.goto(marketSetupPath(marketId, 'form'));
    await addAQuestion(page);

    await page.getByTestId('form-step-essentials').click();
    const asks = page.getByTestId('essential-asks-section').getByRole('checkbox');
    await expect(asks).toBeChecked();
    await asks.uncheck();
    await expect(page.getByTestId('form-builder-save-success')).toBeVisible();

    const res = await request.get(`${BACKEND_URL}/markets/${marketId}/application-form`);
    const { application_form: stored } = (await res.json()) as {
      application_form: { fields: { label: string }[]; unaskedEssentials?: string[] };
    };
    expect(stored.unaskedEssentials).toEqual(['essential_section_ranking']);
    expect(stored.fields.map((field) => field.label)).toEqual(
      APPLICATION_FIELDS.map((field) => field.label),
    );

    // The question is still the organizer's, unsaved, and still asks before it is dropped.
    await page.getByTestId('form-step-questions').click();
    await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(LABEL);
    await page.getByTestId('market-bar-tab-setup').click();
    await expect(question(page)).toBeVisible();
  });
});
