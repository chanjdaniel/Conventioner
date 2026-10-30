/**
 * The form tab is a sequence of steps (E33/F01/S01).
 *
 * The builder and the preview sat side by side and crowded each other. The tab is now four steps,
 * each with the whole width: the essential questions, the organizer's own, the preview, and what a
 * reviewer reads first. A step header reaches any of them; Back and Next move one. The form is the
 * tab's working copy, so moving between steps never loses an unsaved edit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import MarketFormTab from '@/components/market/MarketFormTab.vue';
import type { ApplicationForm, Market, SetupObject } from '@/assets/types/datatypes';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const SETUP = {
  priority: [],
  marketDates: [],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
} as unknown as SetupObject;

const FORM: ApplicationForm = {
  fields: [
    {
      key: 'business_name',
      label: 'Business',
      type: 'text',
      required: false,
      options: [],
      order: 0,
    },
  ],
};

/** A child stub that names itself and keeps the form it was handed, so a test can read it. */
function stub(testid: string) {
  return {
    props: ['applicationForm', 'forApplicants', 'readonly'],
    emits: ['update:applicationForm'],
    template: `<div data-testid="${testid}">{{ applicationForm?.fields?.map((f) => f.label).join(',') }}</div>`,
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { application_form: FORM, essential_options: null } });
});

async function mountTab(market: Partial<Market> = {}): Promise<VueWrapper> {
  const wrapper = mount(MarketFormTab, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        intakeMode: 'form',
        applicationForm: FORM,
        applicationFormLockReason: null,
        readOnlyReason: null,
        actionRefusals: answersRefusing(),
        ...market,
      } as Market,
      setupObject: SETUP,
    },
    global: {
      stubs: {
        FormBuilder: stub('stub-builder'),
        FormPreview: stub('stub-preview'),
        EssentialFieldsPanel: { template: '<div data-testid="stub-essentials" />' },
        ReviewHighlights: {
          props: ['disabled'],
          template: '<div data-testid="stub-highlights" />',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const shown = (wrapper: VueWrapper, testid: string) =>
  wrapper.find(`[data-testid="${testid}"]`).exists();

const stepLabels = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-testid="form-steps"] .step-label').map((label) => label.text());

function currentStep(wrapper: VueWrapper): string {
  return wrapper.get('[data-testid="form-steps"] [aria-current="step"]').text();
}

describe('the form tab is a sequence of steps', () => {
  it('names all four steps and opens on the essential questions', async () => {
    const wrapper = await mountTab();

    const header = wrapper.get('[data-testid="form-steps"]');
    expect(header.element.tagName).toBe('NAV');
    expect(header.attributes('aria-label')).toBeTruthy();
    expect(stepLabels(wrapper)).toEqual([
      'Essential questions',
      'Your questions',
      'Preview',
      'Review setup',
    ]);
    expect(currentStep(wrapper)).toContain('Essential questions');
    expect(shown(wrapper, 'stub-essentials')).toBe(true);
    expect(shown(wrapper, 'stub-builder')).toBe(false);
  });

  it('moves one step with Next and Back, and never shows the builder beside the preview', async () => {
    const wrapper = await mountTab();
    const seen: string[] = [];

    for (let step = 0; step < 3; step++) {
      await wrapper.get('[data-testid="form-step-next"]').trigger('click');
      seen.push(currentStep(wrapper));
      expect(shown(wrapper, 'stub-builder') && shown(wrapper, 'stub-preview')).toBe(false);
    }
    expect(seen.map((s) => s.replace(/^\d/, ''))).toEqual([
      'Your questions',
      'Preview',
      'Review setup',
    ]);
    expect(shown(wrapper, 'form-step-next')).toBe(false);
    expect(shown(wrapper, 'stub-highlights')).toBe(true);

    await wrapper.get('[data-testid="form-step-back"]').trigger('click');
    expect(currentStep(wrapper)).toContain('Preview');
    expect(shown(wrapper, 'stub-preview')).toBe(true);
  });

  it('reaches any step from the header', async () => {
    const wrapper = await mountTab();

    await wrapper.get('[data-testid="form-step-review"]').trigger('click');
    expect(currentStep(wrapper)).toContain('Review setup');
    await wrapper.get('[data-testid="form-step-essentials"]').trigger('click');
    expect(currentStep(wrapper)).toContain('Essential questions');
    expect(shown(wrapper, 'form-step-back')).toBe(false);
  });

  it('keeps an unsaved edit while the organizer moves between steps', async () => {
    const wrapper = await mountTab();
    await wrapper.get('[data-testid="form-step-questions"]').trigger('click');

    const edited = { fields: [{ ...FORM.fields[0], label: 'Stall name' }] };
    wrapper.getComponent('[data-testid="stub-builder"]').vm.$emit('update:applicationForm', edited);
    await wrapper.get('[data-testid="form-step-preview"]').trigger('click');
    expect(wrapper.get('[data-testid="stub-preview"]').text()).toBe('Stall name');
    await wrapper.get('[data-testid="form-step-questions"]').trigger('click');

    expect(wrapper.get('[data-testid="stub-builder"]').text()).toBe('Stall name');
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('a save on any step says so', () => {
  it('reports the essentials’ Ask this, which saves the moment it is ticked', async () => {
    api.put.mockResolvedValue({ data: { application_form: FORM } });
    const wrapper = await mountTab();
    expect(shown(wrapper, 'form-builder-save-button')).toBe(false);

    wrapper
      .getComponent('[data-testid="stub-essentials"]')
      .vm.$emit('toggleUnasked', 'essential_section_ranking', true);
    await flushPromises();

    expect(wrapper.get('[data-testid="form-builder-save-success"]').text()).toBe('Saved');
    expect(shown(wrapper, 'form-builder-save-button')).toBe(false);
  });
});

describe("a Google Form market's steps (E33/F01/S02)", () => {
  it('are three, with no preview: nobody fills its form in', async () => {
    const wrapper = await mountTab({ intakeMode: 'csv' } as Partial<Market>);

    expect(stepLabels(wrapper)).toEqual(['Essential questions', 'Your questions', 'Review setup']);
    await wrapper.get('[data-testid="form-step-questions"]').trigger('click');
    expect(wrapper.get('[data-testid="form-step-next"]').text()).toBe('Next: Review setup');
    expect(shown(wrapper, 'stub-preview')).toBe(false);
  });

  it('tells the builder nobody reads a hint, so it offers none', async () => {
    const wrapper = await mountTab({ intakeMode: 'csv' } as Partial<Market>);
    await wrapper.get('[data-testid="form-step-questions"]').trigger('click');

    expect(wrapper.getComponent('[data-testid="stub-builder"]').props('forApplicants')).toBe(false);
  });

  it("leaves a form market's four steps as they were", async () => {
    const wrapper = await mountTab({ intakeMode: 'form' } as Partial<Market>);

    expect(wrapper.findAll('[data-testid="form-steps"] li')).toHaveLength(4);
    await wrapper.get('[data-testid="form-step-questions"]').trigger('click');
    expect(wrapper.getComponent('[data-testid="stub-builder"]').props('forApplicants')).toBe(true);
  });
});

describe("a Google Form market's essential questions (E33/F01/S02)", () => {
  const EMPTY = { dates: [], sections: [], tableTypes: [], tiers: [] };

  it('say what the import reads, never what an applicant would see', async () => {
    const { default: EssentialFieldsPanel } =
      await import('@/components/application/EssentialFieldsPanel.vue');
    const csv = mount(EssentialFieldsPanel, { props: { options: EMPTY, forApplicants: false } });
    const form = mount(EssentialFieldsPanel, { props: { options: EMPTY } });

    expect(form.text()).toContain('signs in');
    expect(form.text()).toContain('hidden from applicants');
    expect(csv.text()).not.toContain('signs in');
    expect(csv.text()).not.toContain('hidden from applicants');
    expect(csv.text()).not.toContain('application form asks');
    expect(csv.get('[data-testid="essential-dates-empty"]').text()).toContain('import');
  });
});

describe('a locked form opens on the review setup (E33/F01/S03)', () => {
  const LOCKED = 'Application form is locked: 1 application has already been submitted.';

  it('opens on Review setup, which stays editable', async () => {
    const wrapper = await mountTab({ applicationFormLockReason: LOCKED });

    expect(currentStep(wrapper)).toContain('Review setup');
    expect(shown(wrapper, 'stub-highlights')).toBe(true);
    expect(shown(wrapper, 'form-builder-lock-banner')).toBe(false);
  });

  it('keeps the earlier steps one click away, read-only and saying why', async () => {
    const wrapper = await mountTab({ applicationFormLockReason: LOCKED });

    await wrapper.get('[data-testid="form-step-questions"]').trigger('click');
    expect(wrapper.get('[data-testid="form-builder-lock-banner"]').text()).toBe(LOCKED);
    expect(wrapper.getComponent('[data-testid="stub-builder"]').props('readonly')).toBe(true);
    expect(shown(wrapper, 'form-builder-save-button')).toBe(false);
  });

  it('opens an editable form on its first step, as before', async () => {
    const wrapper = await mountTab();

    expect(currentStep(wrapper)).toContain('Essential questions');
  });
});

describe('a person who may only read (E33/F01/S03, review)', () => {
  const READ_ONLY = 'You can view this market, but not change it.';
  /** What a Viewer is served: told by the frame, and refused the form's row. */
  const READER = { readOnlyReason: READ_ONLY, actionRefusals: VIEWER_ANSWERS };

  // The frame says why, once, on every page of the market (T15): the tab says only the form's lock.
  it('is offered no control on Review setup, and not told twice', async () => {
    const wrapper = await mountTab({
      applicationFormLockReason: null,
      ...READER,
    } as Partial<Market>);

    expect(currentStep(wrapper)).toContain('Review setup');
    expect(shown(wrapper, 'form-builder-lock-banner')).toBe(false);
    expect(wrapper.getComponent('[data-testid="stub-highlights"]').props('disabled')).toBe(true);
  });

  it("reads the questions as read-only, and is told only the form's own lock", async () => {
    const LOCKED = 'Application form is locked: 1 application has already been submitted.';
    const open = await mountTab(READER as Partial<Market>);
    await open.get('[data-testid="form-step-questions"]').trigger('click');

    expect(shown(open, 'form-builder-lock-banner')).toBe(false);
    expect(open.getComponent('[data-testid="stub-builder"]').props('readonly')).toBe(true);

    const locked = await mountTab({
      applicationFormLockReason: LOCKED,
      ...READER,
    } as Partial<Market>);
    await locked.get('[data-testid="form-step-questions"]').trigger('click');

    expect(locked.get('[data-testid="form-builder-lock-banner"]').text()).toBe(LOCKED);
  });

  it('leaves Review setup live for someone who may change the market', async () => {
    const wrapper = await mountTab({ applicationFormLockReason: 'Locked.' });

    expect(wrapper.getComponent('[data-testid="stub-highlights"]').props('disabled')).toBe(false);
  });
});

describe('Back and Next', () => {
  it('start the step they open at the top of the page', async () => {
    const scrolled = vi.spyOn(window, 'scrollTo');
    const wrapper = await mountTab();

    await wrapper.get('[data-testid="form-step-next"]').trigger('click');

    expect(scrolled).toHaveBeenCalledWith({ top: 0 });
    scrolled.mockRestore();
  });
});
