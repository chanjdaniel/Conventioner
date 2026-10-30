/**
 * Updating a vendor's info (E41/F01/S01): a dialog of their answers, each in its question's own
 * control, with Save and Cancel. Each answer that differs from what the vendor wrote says what they
 * wrote beside it before Save, and "Use their answer" puts it back. The answers the assignment reads
 * are updated there too, by whoever their own row allows (E41/F01/S02).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import AnswerUpdateNote from '@/components/AnswerUpdateNote.vue';
import UpdateInfoDialog from '@/components/UpdateInfoDialog.vue';
import { CHANGED_SINCE, sameAnswer, updatedLine } from '@/utils/answerUpdates';
import {
  ApplicationStatus,
  ApplicationType,
  type AnswerUpdate,
  type Application,
  type ApplicationForm,
} from '@/assets/types/datatypes';
import {
  AVAILABLE_DATES_KEY,
  FULL_NAME_KEY,
  MAX_DATES_KEY,
  REQUEST_KEY,
  SECTION_RANKING_KEY,
  TABLE_CHOICE_KEY,
  TABLE_SHARE_ANSWER_KEY,
  TABLE_SHARE_EMAIL_KEY,
  TIER_PREFERENCE_KEY,
} from '@/utils/essentialFields';

const sent: { url: string; body: unknown }[] = [];

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    api: {
      put: (url: string, body: { answers: Record<string, unknown> }) => {
        sent.push({ url, body });
        return Promise.resolve({ data: { application: application() } });
      },
    },
  };
});

afterEach(() => {
  sent.length = 0;
});

const FORM: ApplicationForm = {
  fields: [
    { key: 'shop', label: 'Shop name', type: 'text', required: true, options: [], order: 0 },
    {
      key: 'student',
      label: 'Are you a student?',
      type: 'select',
      required: true,
      options: ['Yes', 'No'],
      order: 1,
    },
  ],
} as ApplicationForm;

const UPDATE: AnswerUpdate = {
  value: 'Ember Ceramics',
  by: { userId: 'u1', email: 'sam@market.test' },
  at: '2026-10-30T17:04:00+00:00',
  over: 'Ember Ceramcs',
  theyWrote: 'Ember Ceramcs',
  changedSince: false,
};

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    marketId: 'market-123',
    applicantEmail: 'nadia@ember.test',
    formData: { shop: 'Ember Ceramcs', student: 'No', [FULL_NAME_KEY]: 'Nadia Okonkwo' },
    status: ApplicationStatus.Open,
    applicationType: ApplicationType.Main,
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const THU = '2026-11-19';
const FRI = '2026-11-20';
const OPTIONS = { dates: [THU, FRI], tiers: ['Gold', 'Silver'], sections: [], tableTypes: [] };
const ONLY_AN_ADMIN =
  "Only an Admin or the owner may update the answers this market's assignment reads.";

function dialog(
  app: Application = application(),
  { options = OPTIONS, assignmentRefusal = null as string | null } = {},
) {
  return mount(UpdateInfoDialog, {
    props: {
      open: true,
      marketId: 'market-123',
      application: app,
      form: FORM,
      options,
      assignmentRefusal,
    },
    attachTo: document.body,
  });
}

const testid = (id: string) => `[data-testid="${id}"]`;

describe('the Update info dialog', () => {
  it('holds each answer in its question’s own control, and nothing to save yet', () => {
    const wrapper = dialog();

    expect((wrapper.get(testid('update-info-input-shop')).element as HTMLInputElement).value).toBe(
      'Ember Ceramcs',
    );
    expect(wrapper.get(testid('update-info-input-student')).element.tagName).toBe('SELECT');
    expect(wrapper.get(testid('update-info-submit-button')).attributes('disabled')).toBeDefined();
    expect(wrapper.find(testid('update-info-theirs-shop')).exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows what they wrote beside each answer changed, and saves only those', async () => {
    const wrapper = dialog();

    await wrapper.get(testid('update-info-input-shop')).setValue('Ember Ceramics');
    await wrapper.get(testid('update-info-input-student')).setValue('Yes');

    expect(wrapper.get(testid('update-info-theirs-shop')).text()).toContain(
      'They wrote: Ember Ceramcs',
    );
    expect(wrapper.get(testid('update-info-theirs-student')).text()).toContain('They wrote: No');

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent).toEqual([
      {
        url: '/markets/market-123/applications/app-1/answers',
        body: { answers: { shop: 'Ember Ceramics', student: 'Yes' } },
      },
    ]);
    expect(wrapper.emitted('saved')).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps both of two answers changed before it renders again', async () => {
    const wrapper = dialog();
    const shop = wrapper.get(testid('update-info-input-shop')).element as HTMLInputElement;
    const student = wrapper.get(testid('update-info-input-student')).element as HTMLSelectElement;

    shop.value = 'Ember Ceramics';
    shop.dispatchEvent(new Event('input'));
    student.value = 'Yes';
    student.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(shop.value).toBe('Ember Ceramics');
    expect(wrapper.find(testid('update-info-theirs-shop')).exists()).toBe(true);
    expect(wrapper.find(testid('update-info-theirs-student')).exists()).toBe(true);
    wrapper.unmount();
  });

  it('says beside an update that their answer changed since', () => {
    const wrapper = dialog(
      application({
        formData: { shop: 'Ember Ceramics', student: 'No' },
        answerUpdates: {
          shop: { ...UPDATE, theyWrote: 'Ember Pottery', changedSince: true },
        },
      }),
    );

    expect(wrapper.get(testid('update-info-theirs-shop')).text()).toContain(
      'They wrote: Ember Pottery',
    );
    expect(wrapper.get(testid('update-info-updated-shop')).text()).toContain(CHANGED_SINCE);
    wrapper.unmount();
  });

  it('cancels without sending anything', async () => {
    const wrapper = dialog();
    await wrapper.get(testid('update-info-input-shop')).setValue('Ember Ceramics');

    await wrapper.get(testid('update-info-cancel-button')).trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(sent).toEqual([]);
    wrapper.unmount();
  });

  it('puts their answer back, and saves that as taking the update away', async () => {
    const wrapper = dialog(
      application({
        formData: { shop: 'Ember Ceramics', student: 'No' },
        answerUpdates: { shop: UPDATE },
      }),
    );

    // What they wrote is in the box beside it; the line says who and when.
    expect(wrapper.get(testid('update-info-theirs-shop')).text()).toContain(
      'They wrote: Ember Ceramcs',
    );
    expect(wrapper.get(testid('update-info-updated-shop')).text()).toMatch(
      /^Updated by sam@market\.test, .+\.$/,
    );
    await wrapper.get(testid('update-info-use-theirs-shop')).trigger('click');

    expect((wrapper.get(testid('update-info-input-shop')).element as HTMLInputElement).value).toBe(
      'Ember Ceramcs',
    );
    expect(wrapper.find(testid('update-info-theirs-shop')).exists()).toBe(false);
    expect(wrapper.find(testid('update-info-goes-back-shop')).exists()).toBe(true);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent[0].body).toEqual({ answers: { shop: 'Ember Ceramcs' } });
    wrapper.unmount();
  });
});

/** A vendor who answered every essential question: Gold on Thursday, both tiers on Friday. */
function essentialApplication(overrides: Partial<Application> = {}): Application {
  return application({
    formData: {
      shop: 'Ember Ceramcs',
      student: 'No',
      [FULL_NAME_KEY]: 'Nadia Okonkwo',
      [AVAILABLE_DATES_KEY]: [THU, FRI],
      [MAX_DATES_KEY]: 2,
      [TIER_PREFERENCE_KEY]: { [THU]: ['Gold'], [FRI]: ['Gold', 'Silver'] },
      [TABLE_CHOICE_KEY]: 'full',
      [TABLE_SHARE_EMAIL_KEY]: '',
      [TABLE_SHARE_ANSWER_KEY]: '',
      [REQUEST_KEY]: '',
    },
    ...overrides,
  });
}

const tier = (date: string, name: string) => testid(`update-info-essential-tier-${date}-${name}`);

describe('the answers the assignment reads, in the Update info dialog', () => {
  it('takes Thursday from Gold to Silver, and sends the day grid with nothing else', async () => {
    const wrapper = dialog(essentialApplication());

    await wrapper.get(tier(THU, 'Silver')).setValue(true);
    await wrapper.get(tier(THU, 'Gold')).setValue(false);

    expect(wrapper.get(testid(`update-info-theirs-${TIER_PREFERENCE_KEY}`)).text()).toContain(
      'Gold',
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent[0].body).toEqual({
      answers: {
        [AVAILABLE_DATES_KEY]: [THU, FRI],
        [TIER_PREFERENCE_KEY]: { [THU]: ['Silver'], [FRI]: ['Gold', 'Silver'] },
      },
    });
    wrapper.unmount();
  });

  it('reads a tier ticked off and on again as unchanged', async () => {
    const wrapper = dialog(essentialApplication());

    await wrapper.get(tier(FRI, 'Gold')).setValue(false);
    await wrapper.get(tier(FRI, 'Gold')).setValue(true);

    expect(wrapper.find(testid(`update-info-theirs-${TIER_PREFERENCE_KEY}`)).exists()).toBe(false);
    expect(wrapper.get(testid('update-info-submit-button')).attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('asks the table-share question in their words', async () => {
    const wrapper = dialog(
      essentialApplication({
        formData: {
          ...essentialApplication().formData,
          [TABLE_SHARE_EMAIL_KEY]: 'ana@example.com',
          [TABLE_SHARE_ANSWER_KEY]: 'Seat me with Ana, ana@example.com',
        },
      }),
    );
    const share = wrapper.get(testid('update-info-essential-table-share-email-input'));

    expect((share.element as HTMLInputElement).value).toBe('Seat me with Ana, ana@example.com');
    await share.setValue('bo@example.com');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent[0].body).toEqual({ answers: { [TABLE_SHARE_EMAIL_KEY]: 'bo@example.com' } });
    wrapper.unmount();
  });

  it('does not send a ranking the form fills in on opening', async () => {
    const wrapper = dialog(essentialApplication(), {
      options: { ...OPTIONS, sections: ['Upper Atrium', 'Lower Atrium'] },
    });

    expect(wrapper.find(testid(`update-info-theirs-${SECTION_RANKING_KEY}`)).exists()).toBe(false);
    expect(wrapper.get(testid('update-info-submit-button')).attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('shows them read-only to whoever the row refuses, and says who may', async () => {
    const wrapper = dialog(essentialApplication(), { assignmentRefusal: ONLY_AN_ADMIN });

    expect(wrapper.get(testid('update-info-essentials-note')).text()).toBe(ONLY_AN_ADMIN);
    expect(wrapper.get(tier(THU, 'Gold')).attributes('disabled')).toBeDefined();
    expect(
      wrapper.get(testid('update-info-essential-max-dates-input')).attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get(testid('update-info-essential-table-choice-half')).attributes('disabled'),
    ).toBeDefined();
    // The names and the request are no answer the assignment reads.
    const name = wrapper.get(testid('update-info-essential-full-name-input'));
    expect(name.attributes('disabled')).toBeUndefined();
    await name.setValue('Nadia Okonkwo-Reyes');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent[0].body).toEqual({ answers: { [FULL_NAME_KEY]: 'Nadia Okonkwo-Reyes' } });
    wrapper.unmount();
  });

  it('says who updated the tiers, and puts their answer back', async () => {
    const wrapper = dialog(
      essentialApplication({
        formData: {
          ...essentialApplication().formData,
          [TIER_PREFERENCE_KEY]: { [THU]: ['Silver'], [FRI]: ['Gold', 'Silver'] },
        },
        answerUpdates: {
          [TIER_PREFERENCE_KEY]: {
            ...UPDATE,
            value: { [THU]: ['Silver'], [FRI]: ['Gold', 'Silver'] },
            over: { [THU]: ['Gold'], [FRI]: ['Gold', 'Silver'] },
            theyWrote: { [THU]: ['Gold'], [FRI]: ['Gold', 'Silver'] },
          },
        },
      }),
    );

    expect(wrapper.get(testid(`update-info-updated-${TIER_PREFERENCE_KEY}`)).text()).toMatch(
      /^Updated by sam@market\.test/,
    );
    await wrapper.get(testid(`update-info-use-theirs-${TIER_PREFERENCE_KEY}`)).trigger('click');

    expect((wrapper.get(tier(THU, 'Gold')).element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find(testid(`update-info-goes-back-${TIER_PREFERENCE_KEY}`)).exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it('offers whoever the row refuses no way to put a locked answer back', () => {
    const wrapper = dialog(
      essentialApplication({
        formData: {
          ...essentialApplication().formData,
          [TIER_PREFERENCE_KEY]: { [THU]: ['Silver'], [FRI]: ['Gold', 'Silver'] },
        },
        answerUpdates: {
          [TIER_PREFERENCE_KEY]: {
            ...UPDATE,
            value: { [THU]: ['Silver'], [FRI]: ['Gold', 'Silver'] },
            over: { [THU]: ['Gold'], [FRI]: ['Gold', 'Silver'] },
            theyWrote: { [THU]: ['Gold'], [FRI]: ['Gold', 'Silver'] },
          },
        },
      }),
      { assignmentRefusal: ONLY_AN_ADMIN },
    );

    // What they wrote, and who updated it, still show; putting it back is the row's.
    expect(wrapper.get(testid(`update-info-theirs-${TIER_PREFERENCE_KEY}`)).text()).toContain(
      'They wrote:',
    );
    expect(wrapper.find(testid(`update-info-updated-${TIER_PREFERENCE_KEY}`)).exists()).toBe(true);
    expect(wrapper.find(testid(`update-info-use-theirs-${TIER_PREFERENCE_KEY}`)).exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it('finds an update kept under the dates alone, on a market without tiers', () => {
    const wrapper = dialog(
      essentialApplication({
        formData: {
          ...essentialApplication().formData,
          [TIER_PREFERENCE_KEY]: {},
        },
        answerUpdates: {
          [AVAILABLE_DATES_KEY]: {
            ...UPDATE,
            value: [THU, FRI],
            over: [THU],
            theyWrote: [THU],
          },
        },
      }),
      { options: { ...OPTIONS, tiers: [] } },
    );

    expect(wrapper.get(testid(`update-info-theirs-${TIER_PREFERENCE_KEY}`)).text()).toContain(
      'They wrote:',
    );
    expect(wrapper.get(testid(`update-info-use-theirs-${TIER_PREFERENCE_KEY}`)).text()).toBe(
      'Use their answer',
    );
    wrapper.unmount();
  });

  it('asks for a number of dates only where the vendor gave one', () => {
    const required = (app: Application) => {
      const wrapper = dialog(app);
      const asked = wrapper
        .get(testid('update-info-essential-max-dates'))
        .find('.essential-required')
        .exists();
      wrapper.unmount();
      return asked;
    };
    const noLimit = essentialApplication();
    noLimit.formData = { ...noLimit.formData, [MAX_DATES_KEY]: null };

    expect(required(essentialApplication())).toBe(true);
    expect(required(noLimit)).toBe(false);
  });
});

describe('the words beside an updated answer', () => {
  it('say who, when and what they wrote', () => {
    expect(updatedLine(UPDATE, 'Ember Ceramcs')).toMatch(
      /^Updated by sam@market\.test, .+ at .+; they wrote Ember Ceramcs$/,
    );
  });

  it('say they left it blank when they wrote nothing', () => {
    expect(updatedLine(UPDATE, ' ')).toMatch(/; they left it blank$/);
  });

  it('say when their answer changed since', () => {
    expect(CHANGED_SINCE).toBe('Their answer changed since your update.');
  });
});

describe('a multi-select answer', () => {
  it('reads one way beside an update, in the drawer, the dialog and the review card', () => {
    const update = {
      ...UPDATE,
      value: ['Pins'],
      over: ['Prints', 'Cards'],
      theyWrote: ['Prints', 'Cards'],
    };
    const note = mount(AnswerUpdateNote, { props: { update, testid: 'note' } });

    expect(note.get(testid('note-updated')).text()).toMatch(/; they wrote Prints · Cards$/);
  });
});

describe('two answers alike', () => {
  it.each([
    [' Ember ', 'Ember'],
    [12, '12'],
    [null, ''],
    [undefined, []],
    [
      ['Prints', 'Cards'],
      ['Prints', 'Cards'],
    ],
  ])('%j and %j', (a, b) => {
    expect(sameAnswer(a, b)).toBe(true);
  });

  it('reads the tiers on each date by date, whatever order the dates come in', () => {
    expect(sameAnswer({ [THU]: ['Gold'], [FRI]: [] }, { [THU]: ['Gold'] })).toBe(true);
    expect(
      sameAnswer({ [FRI]: ['Gold'], [THU]: ['Gold'] }, { [THU]: ['Gold'], [FRI]: ['Gold'] }),
    ).toBe(true);
    expect(sameAnswer({ [THU]: ['Gold'] }, { [THU]: ['Silver'] })).toBe(false);
  });

  it('tells a list from its reordering', () => {
    expect(sameAnswer(['Prints', 'Cards'], ['Cards', 'Prints'])).toBe(false);
  });
});
