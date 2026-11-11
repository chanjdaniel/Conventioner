/**
 * The form tab keeps the revision of the form it read, and meeting "market changed" reads the form
 * again (ADR 0024).
 *
 * Every save of the form sends the `formRevision` its copy came from, and the server refuses a copy
 * older than the stored form with its one 409, `{"error": <the sentence>, "code": "market_changed"}`,
 * storing nothing. The tab then shows the sentence where a save's error shows, and puts back the
 * form as it now stands, with its revision for the next save. The store's market is read again by
 * the market-changed interceptor, as for every write (`aMarketThatChangedUnderAWrite.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import MarketFormTab from '@/components/market/MarketFormTab.vue';
import FormBuilder from '@/components/application/FormBuilder.vue';
import EssentialFieldsPanel from '@/components/application/EssentialFieldsPanel.vue';
import type { ApplicationForm, FormField } from '@/assets/types/datatypes';
import { MARKET_CHANGED_CODE } from '@/utils/api';
import { MARKET_ID, marketRoute, marketRouter, serveMarket } from './support/marketScreen';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
/** What the application-form endpoint answers; the market is served by `GET /markets/:id`. */
const formApi = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => marketRouter(),
  useRoute: () => marketRoute('form'),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const SENTENCE =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';
const FORM_URL = `/markets/${MARKET_ID}/application-form`;

function field(key: string, label: string, order: number): FormField {
  return { key, label, type: 'text', required: false, options: [], order };
}
const SHOP = field('shop_name', 'Shop', 0);
const WEBSITE = field('website', 'Website', 1);
const INSTAGRAM = field('instagram', 'Instagram', 1);

function form(...fields: FormField[]): ApplicationForm {
  return { fields, unaskedEssentials: [] };
}

/** The form read's answer, at `formRevision`. */
function formRead(applicationForm: ApplicationForm, formRevision: number) {
  return { data: { application_form: applicationForm, essential_options: null, formRevision } };
}

function marketChanged() {
  return Object.assign(new AxiosError('refused'), {
    response: { status: 409, data: { error: SENTENCE, code: MARKET_CHANGED_CODE } },
  });
}

function serve(applicationForm: ApplicationForm) {
  serveMarket(
    api.get,
    {
      id: MARKET_ID,
      name: 'Riverside',
      setupObject: {
        priority: [],
        marketDates: [],
        tiers: [],
        locations: [],
        sections: [],
        assignmentOptions: {},
      },
      applicationForm,
      applicationFormLockReason: null,
    },
    (url) => formApi(url),
  );
}

async function mountOnFormTab() {
  const wrapper = mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        MarketFrame: false,
        MarketFormTab: false,
        StepHeader: false,
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
  await vi.waitFor(() => expect(wrapper.findComponent(MarketFormTab).exists()).toBe(true));
  await flushPromises();
  return wrapper;
}

async function openQuestions(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="form-step-questions"]').trigger('click');
  await flushPromises();
}

async function edit(wrapper: ReturnType<typeof mount>, edited: ApplicationForm) {
  wrapper.findComponent(FormBuilder).vm.$emit('update:applicationForm', edited);
  await flushPromises();
}

async function save(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="form-builder-save-button"]').trigger('click');
  await flushPromises();
}

const formReads = () => formApi.mock.calls.filter(([url]) => url === FORM_URL).length;
const sentRevisions = () => api.put.mock.calls.map(([, body]) => body.formRevision);

beforeEach(() => {
  setActivePinia(createPinia());
  formApi.mockReset();
  api.get.mockReset();
  api.put.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the form tab and the revision of its form', () => {
  it('sends the revision its form was read at, then the one each save answered', async () => {
    serve(form(SHOP));
    formApi.mockResolvedValue(formRead(form(SHOP), 4));
    api.put
      .mockResolvedValueOnce({ data: { application_form: form(SHOP, WEBSITE), formRevision: 5 } })
      .mockResolvedValueOnce({
        data: {
          application_form: form(SHOP, WEBSITE, { ...INSTAGRAM, order: 2 }),
          formRevision: 6,
        },
      });
    const wrapper = await mountOnFormTab();
    await openQuestions(wrapper);

    await edit(wrapper, form(SHOP, WEBSITE));
    await save(wrapper);
    await edit(wrapper, form(SHOP, WEBSITE, { ...INSTAGRAM, order: 2 }));
    await save(wrapper);

    expect(api.put.mock.calls.map(([url]) => url)).toEqual([FORM_URL, FORM_URL]);
    expect(sentRevisions()).toEqual([4, 5]);
    expect(api.put.mock.calls[0]?.[1].fields.map((f: FormField) => f.key)).toEqual([
      'shop_name',
      'website',
    ]);
  });

  it('sends it with the unasked-essentials toggle, and takes the one it answered', async () => {
    serve(form(SHOP));
    formApi.mockResolvedValue(formRead(form(SHOP), 2));
    api.put.mockResolvedValue({
      data: { application_form: { ...form(SHOP), unaskedEssentials: ['x'] }, formRevision: 3 },
    });
    const wrapper = await mountOnFormTab();

    wrapper.findComponent(EssentialFieldsPanel).vm.$emit('toggleUnasked', 'x', true);
    await flushPromises();
    await openQuestions(wrapper);
    await edit(wrapper, form(SHOP, WEBSITE));
    await save(wrapper);

    expect(sentRevisions()).toEqual([2, 3]);
  });

  it('a refused Save reads the form again, shows the sentence and the form as it now stands', async () => {
    serve(form(SHOP));
    // Page A saved the website question since this tab read the form.
    formApi
      .mockResolvedValueOnce(formRead(form(SHOP), 0))
      .mockResolvedValue(formRead(form(SHOP, WEBSITE), 1));
    api.put.mockRejectedValueOnce(marketChanged());
    const wrapper = await mountOnFormTab();
    await openQuestions(wrapper);

    await edit(wrapper, form(SHOP, INSTAGRAM));
    await save(wrapper);

    expect(formReads()).toBe(2);
    expect(wrapper.get('[data-testid="form-builder-save-error"]').text()).toBe(SENTENCE);
    expect(
      wrapper
        .findComponent(FormBuilder)
        .props('applicationForm')
        ?.fields.map((f: FormField) => f.key),
    ).toEqual(['shop_name', 'website']);

    // The next save stands on the form it read again.
    api.put.mockResolvedValueOnce({
      data: { application_form: form(SHOP, WEBSITE), formRevision: 2 },
    });
    await edit(wrapper, form(SHOP, WEBSITE));
    await save(wrapper);
    expect(sentRevisions()).toEqual([0, 1]);
  });

  it('a Save refused for another reason reads nothing again', async () => {
    serve(form(SHOP));
    formApi.mockResolvedValue(formRead(form(SHOP), 0));
    api.put.mockRejectedValueOnce(
      Object.assign(new AxiosError('refused'), {
        response: { status: 400, data: { error: 'Invalid application form data' } },
      }),
    );
    const wrapper = await mountOnFormTab();
    await openQuestions(wrapper);

    await edit(wrapper, form(SHOP, WEBSITE));
    await save(wrapper);

    expect(formReads()).toBe(1);
    expect(wrapper.get('[data-testid="form-builder-save-error"]').text()).toBe(
      'Invalid application form data',
    );
  });
});
