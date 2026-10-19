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
import { createPinia, setActivePinia } from 'pinia';

import MarketFormTab from '@/components/market/MarketFormTab.vue';
import type { ApplicationForm, Market, SetupObject } from '@/assets/types/datatypes';

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
    props: ['applicationForm'],
    emits: ['update:applicationForm'],
    template: `<div data-testid="${testid}">{{ applicationForm?.fields?.map((f) => f.label).join(',') }}</div>`,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { application_form: FORM, essential_options: null } });
});

async function mountTab(market: Partial<Market> = {}): Promise<VueWrapper> {
  const wrapper = mount(MarketFormTab, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        applicationForm: FORM,
        applicationFormLockReason: null,
        readOnlyReason: null,
        ...market,
      } as Market,
      setupObject: SETUP,
    },
    global: {
      stubs: {
        FormBuilder: stub('stub-builder'),
        FormPreview: stub('stub-preview'),
        EssentialFieldsPanel: { template: '<div data-testid="stub-essentials" />' },
        ReviewHighlights: { template: '<div data-testid="stub-highlights" />' },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const shown = (wrapper: VueWrapper, testid: string) =>
  wrapper.find(`[data-testid="${testid}"]`).exists();

function currentStep(wrapper: VueWrapper): string {
  return wrapper.get('[data-testid="form-steps"] [aria-current="step"]').text();
}

describe('the form tab is a sequence of steps', () => {
  it('names all four steps and opens on the essential questions', async () => {
    const wrapper = await mountTab();

    const header = wrapper.get('[data-testid="form-steps"]');
    expect(header.element.tagName).toBe('NAV');
    expect(header.attributes('aria-label')).toBeTruthy();
    expect(header.findAll('li').map((li) => li.text())).toEqual([
      '1Essential questions',
      '2Your questions',
      '3Preview',
      '4Review setup',
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
