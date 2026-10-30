/**
 * Updating a vendor's info (E41/F01/S01): a dialog of their answers, each in its question's own
 * control, with Save and Cancel. Each answer that differs from what the vendor wrote says what they
 * wrote beside it before Save, and "Use their answer" puts it back.
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
import { FULL_NAME_KEY } from '@/utils/essentialFields';

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

function dialog(app: Application = application()) {
  return mount(UpdateInfoDialog, {
    props: { open: true, marketId: 'market-123', application: app, form: FORM },
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

  it('shows the answers the assignment reads read-only', () => {
    const wrapper = dialog();

    const essentials = wrapper.get(testid('update-info-essentials'));
    expect(essentials.text()).toContain('Nadia Okonkwo');
    expect(essentials.findAll('input, select, textarea')).toHaveLength(0);
    wrapper.unmount();
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

  it('tells a list from its reordering', () => {
    expect(sameAnswer(['Prints', 'Cards'], ['Cards', 'Prints'])).toBe(false);
  });
});
