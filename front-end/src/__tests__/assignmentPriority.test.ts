// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ElementAssignmentPriority from '@/components/elements/ElementAssignmentPriority.vue';
import {
  ALL_OTHERS,
  PriorityDirection,
  type FormField,
  type SetupObject,
} from '@/assets/types/datatypes';

/**
 * The rebuilt priority screen: a rule names one of the organizer's own form questions and
 * arranges its answers. There is no data-type dropdown any more, which is the point - the one
 * that used to sit here let an organizer pick a type the solver read nothing from.
 */
function field(partial: Partial<FormField> & { key: string }): FormField {
  return {
    label: partial.key,
    type: 'select',
    required: false,
    options: [],
    order: 0,
    ...partial,
  };
}

const RETURNING = field({
  key: 'returning_vendor',
  label: 'Have you sold with us before?',
  options: ['Yes', 'No'],
});
const CATEGORY = field({
  key: 'category',
  label: 'What do you sell?',
  type: 'multi_select',
  options: ['Food', 'Vintage', 'Ceramics'],
});
const NOTES = field({ key: 'notes', label: 'Anything else?', type: 'text' });

function setup(): SetupObject {
  return {
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
    },
  } as unknown as SetupObject;
}

function mountPriority(formFields: FormField[] = [RETURNING, CATEGORY, NOTES]) {
  return mount(ElementAssignmentPriority, {
    props: { setupObject: setup(), formFields },
  });
}

describe('ElementAssignmentPriority', () => {
  it('offers the organizer their own questions as targets', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

    const options = wrapper.find('[data-testid="priority-target-select"]').findAll('option');
    const labels = options.map((option) => option.text());

    expect(labels).toContain('Have you sold with us before?');
    expect(labels).toContain('What do you sell?');
  });

  it('does not offer a free-text question, which has no arrangement to make', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

    const labels = wrapper
      .find('[data-testid="priority-target-select"]')
      .findAll('option')
      .map((option) => option.text());

    expect(labels).not.toContain('Anything else?');
  });

  it('says so when the form has no question a rule could target', () => {
    const wrapper = mountPriority([NOTES]);

    expect(wrapper.text()).toContain('Add a question with a fixed set of answers');
  });

  it('no longer asks for a data type', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

    expect(wrapper.text()).not.toContain('Data type');
    expect(wrapper.text()).not.toContain('Does not contain');
  });

  it('adds a rule with no target and no ordering yet', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

    const [rule] = wrapper.props('setupObject').priority;
    expect(rule).toMatchObject({ target: null, ordering: [] });
  });

  it('gives each rule a distinct id even after one is removed', async () => {
    const wrapper = mountPriority();
    const add = wrapper.find('[data-testid="priority-add-rule"]');
    await add.trigger('click');
    await add.trigger('click');
    await wrapper.findAll('[data-testid="priority-rule-remove"]')[0].trigger('click');
    await add.trigger('click');

    const ids = wrapper.props('setupObject').priority.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the target question answers to arrange, plus an all-others token', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
    await wrapper.find('[data-testid="priority-target-select"]').setValue(RETURNING.key);

    const choices = wrapper
      .find('[data-testid="priority-ordering-add"]')
      .findAll('option')
      .map((option) => option.text());

    expect(choices).toContain('Yes');
    expect(choices).toContain('No');
    expect(choices).toContain(ALL_OTHERS);
  });

  it('records an answer in the order the organizer adds it', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
    await wrapper.find('[data-testid="priority-target-select"]').setValue(RETURNING.key);

    const adder = wrapper.find('[data-testid="priority-ordering-add"]');
    await adder.setValue('No');
    await adder.setValue('Yes');

    expect(wrapper.props('setupObject').priority[0].ordering).toEqual(['No', 'Yes']);
  });

  it('stops offering an answer once it has been placed', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
    await wrapper.find('[data-testid="priority-target-select"]').setValue(RETURNING.key);
    await wrapper.find('[data-testid="priority-ordering-add"]').setValue('Yes');

    const choices = wrapper
      .find('[data-testid="priority-ordering-add"]')
      .findAll('option')
      .map((option) => option.text());

    expect(choices).not.toContain('Yes');
    expect(choices).toContain('No');
  });

  it('removing an answer puts it back on offer', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
    await wrapper.find('[data-testid="priority-target-select"]').setValue(RETURNING.key);
    await wrapper.find('[data-testid="priority-ordering-add"]').setValue('Yes');
    await wrapper.find('[data-testid="priority-ordering-remove"]').trigger('click');

    expect(wrapper.props('setupObject').priority[0].ordering).toEqual([]);
  });

  it('retargeting a rule discards an ordering built from another question answers', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
    const target = wrapper.find('[data-testid="priority-target-select"]');
    await target.setValue(RETURNING.key);
    await wrapper.find('[data-testid="priority-ordering-add"]').setValue('Yes');

    await target.setValue(CATEGORY.key);

    expect(wrapper.props('setupObject').priority[0].ordering).toEqual([]);
  });

  it('removes a rule the organizer no longer wants', async () => {
    const wrapper = mountPriority();
    await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
    await wrapper.find('[data-testid="priority-rule-remove"]').trigger('click');

    expect(wrapper.props('setupObject').priority).toEqual([]);
  });

  describe('targets that are attributes of the application', () => {
    it('offers ordering by when the application arrived', async () => {
      const wrapper = mountPriority();
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

      const labels = wrapper
        .find('[data-testid="priority-target-select"]')
        .findAll('option')
        .map((option) => option.text());

      expect(labels).toContain('When the application arrived');
    });

    it('keeps them in their own group, apart from the organizer questions', async () => {
      const wrapper = mountPriority();
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

      const groups = wrapper
        .find('[data-testid="priority-target-select"]')
        .findAll('optgroup')
        .map((group) => group.attributes('label'));

      expect(groups).toEqual(['Your questions', 'About the application']);
    });

    it('still offers them when the form has no targetable question of its own', async () => {
      const wrapper = mountPriority([NOTES]);
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

      const labels = wrapper
        .find('[data-testid="priority-target-select"]')
        .findAll('option')
        .map((option) => option.text());

      expect(labels).toContain('When the application arrived');
    });
  });

  describe('a target ordered by magnitude', () => {
    const RATING = field({ key: 'rating', label: 'How many stars?', type: 'number' });

    it('asks for a direction rather than an arrangement', async () => {
      const wrapper = mountPriority([RATING]);
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
      await wrapper.find('[data-testid="priority-target-select"]').setValue(RATING.key);

      expect(wrapper.find('[data-testid="priority-direction-select"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="priority-ordering-add"]').exists()).toBe(false);
    });

    it('words the direction for the kind of target it is', async () => {
      const wrapper = mountPriority([RATING]);
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
      await wrapper.find('[data-testid="priority-target-select"]').setValue(RATING.key);

      const choices = wrapper
        .find('[data-testid="priority-direction-select"]')
        .findAll('option')
        .map((option) => option.text());

      expect(choices).toEqual(['Lowest first', 'Highest first']);
    });

    it('words it differently for a date', async () => {
      const wrapper = mountPriority();
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
      await wrapper
        .find('[data-testid="priority-target-select"]')
        .setValue('application.submitted_at');

      const choices = wrapper
        .find('[data-testid="priority-direction-select"]')
        .findAll('option')
        .map((option) => option.text());

      expect(choices).toEqual(['Earliest first', 'Latest first']);
    });

    it('starts from a direction rather than from nothing', async () => {
      const wrapper = mountPriority([RATING]);
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
      await wrapper.find('[data-testid="priority-target-select"]').setValue(RATING.key);

      expect(wrapper.props('setupObject').priority[0].direction).toBe(PriorityDirection.Ascending);
    });

    it('clears the direction when retargeted at a question with arrangeable answers', async () => {
      const wrapper = mountPriority([RATING, RETURNING]);
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');
      const target = wrapper.find('[data-testid="priority-target-select"]');
      await target.setValue(RATING.key);
      await target.setValue(RETURNING.key);

      expect(wrapper.props('setupObject').priority[0].direction).toBeNull();
    });

    it('does not offer a free-text question, which has no magnitude either', async () => {
      const wrapper = mountPriority([NOTES]);
      await wrapper.find('[data-testid="priority-add-rule"]').trigger('click');

      const labels = wrapper
        .find('[data-testid="priority-target-select"]')
        .findAll('option')
        .map((option) => option.text());

      expect(labels).not.toContain('Anything else?');
    });
  });
});

/**
 * Settled rules read as they were run (E22/F02/S02). Once the market can no longer run its
 * assignment, a changed rule would change nothing, so nothing here offers to change one.
 */
describe('ElementAssignmentPriority, read-only', () => {
  const rules = (): SetupObject =>
    ({
      ...setup(),
      priority: [{ id: 0, target: 'returning_vendor', ordering: ['Yes', 'No'] }],
    }) as unknown as SetupObject;

  it('shows the rules but offers no way to change them', () => {
    const wrapper = mount(ElementAssignmentPriority, {
      props: { setupObject: rules(), formFields: [RETURNING], readonly: true },
    });

    expect(wrapper.findAll('[data-testid="priority-rule-row"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="priority-ordering-row"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="priority-target-select"]').attributes()).toHaveProperty(
      'disabled',
    );
    for (const control of [
      'priority-add-rule',
      'priority-rule-remove',
      'priority-ordering-remove',
      'priority-ordering-add',
    ]) {
      expect(wrapper.find(`[data-testid="${control}"]`).exists(), control).toBe(false);
    }
    expect(wrapper.find('.drag-handle').exists()).toBe(false);
  });
});

describe('ElementAssignmentPriority, read-only with no rules', () => {
  it('says there were none, rather than inviting an edit that cannot happen', () => {
    const wrapper = mount(ElementAssignmentPriority, {
      props: { setupObject: setup(), formFields: [], readonly: true },
    });

    expect(wrapper.find('[data-testid="priority-none-set"]').text()).toContain('No priority rules');
    expect(wrapper.text()).not.toContain('Add a question');
  });
});

describe('ElementAssignmentPriority, a question of many answers (T223)', () => {
  const asked = (count: number) =>
    field({
      key: 'selling',
      label: 'What do you sell?',
      options: Array.from({ length: count }, (_, at) => `Answer ${at + 1}`),
    });

  async function ruleOn(formFields: FormField[]) {
    const wrapper = mount(ElementAssignmentPriority, {
      props: { setupObject: setup(), formFields },
      attachTo: document.body,
    });
    await wrapper.get('[data-testid="priority-add-rule"]').trigger('click');
    await wrapper.get('[data-testid="priority-target-select"]').setValue('selling');
    return wrapper;
  }
  const ordering = (wrapper: Awaited<ReturnType<typeof ruleOn>>) =>
    wrapper.props('setupObject').priority[0]!.ordering;

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stays a select with "All others" first, 11 answers and "All others" being 12', async () => {
    const wrapper = await ruleOn([asked(11)]);
    const add = wrapper.get('select[data-testid="priority-ordering-add"]');

    expect(
      add
        .findAll('option')
        .map((option) => option.text())
        .slice(0, 3),
    ).toEqual(['Add an answer', ALL_OTHERS, 'Answer 1']);
    expect(wrapper.find('[data-testid="priority-ordering-add-input"]').exists()).toBe(false);

    await add.setValue('Answer 2');
    expect(ordering(wrapper)).toEqual(['Answer 2']);
    expect((add.element as HTMLSelectElement).value).toBe('');
    wrapper.unmount();
  });

  it('is a field at 12 answers and "All others", and stays one as answers are added', async () => {
    const wrapper = await ruleOn([asked(12)]);
    const input = wrapper.get('[data-testid="priority-ordering-add-input"]');
    (input.element as HTMLInputElement).focus();
    expect(wrapper.find('label.visually-hidden').text()).toContain('Rule 1');
    expect(input.attributes('placeholder')).toBe('Add an answer');

    await input.setValue('Answer 2');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(ordering(wrapper)).toEqual(['Answer 2']);
    // 12 left is under the threshold, and the control must not turn into a select under the caret.
    expect(wrapper.find('select[data-testid="priority-ordering-add"]').exists()).toBe(false);
    const after = wrapper.get('[data-testid="priority-ordering-add-input"]');
    expect(after.element).toBe(input.element);
    expect(document.activeElement).toBe(input.element);
    expect((after.element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });

  it('keeps "All others" in reach at the top of a list the cap cuts short', async () => {
    const wrapper = await ruleOn([asked(230)]);
    const input = wrapper.get('[data-testid="priority-ordering-add-input"]');
    await input.trigger('click');

    const rows = wrapper.findAll('[data-testid="priority-ordering-add-option"]');
    expect(rows[0]!.text()).toBe(ALL_OTHERS);
    expect(rows).toHaveLength(50);
    expect(wrapper.get('[data-testid="priority-ordering-add-more"]').text()).toContain('181 more');
    wrapper.unmount();
  });

  it('takes an added answer off the list, and a removed one back', async () => {
    const wrapper = await ruleOn([asked(20)]);
    const input = wrapper.get('[data-testid="priority-ordering-add-input"]');
    await input.setValue('Answer 20');
    await input.trigger('keydown', { key: 'Enter' });
    await input.setValue('Answer 20');
    expect(wrapper.find('[data-testid="priority-ordering-add-none"]').exists()).toBe(true);
    await input.trigger('blur');

    await wrapper.get('[data-testid="priority-ordering-remove"]').trigger('click');
    await input.setValue('Answer 20');
    expect(wrapper.get('[data-testid="priority-ordering-add-option"]').text()).toBe('Answer 20');
    wrapper.unmount();
  });

  describe('the question it orders by', () => {
    const many = Array.from({ length: 11 }, (_, at) =>
      field({ key: `q${at}`, label: `Question ${at}`, options: ['Yes'] }),
    );

    it('is a select with its groups, at 11 questions and the two built in', async () => {
      const wrapper = mount(ElementAssignmentPriority, {
        props: { setupObject: setup(), formFields: many.slice(0, 10) },
      });
      await wrapper.get('[data-testid="priority-add-rule"]').trigger('click');

      const target = wrapper.get('select[data-testid="priority-target-select"]');
      expect(target.findAll('optgroup').map((group) => group.attributes('label'))).toEqual([
        'Your questions',
        'About the application',
      ]);
      expect((target.element as HTMLSelectElement).value).toBe('');
      expect(target.findAll('option')[0]!.text()).toBe('Select a question');
    });

    it('leaves no empty row once a question is chosen, as a choice is not taken back', async () => {
      const wrapper = await ruleOn([asked(2)]);
      const target = wrapper.get('select[data-testid="priority-target-select"]');

      expect((target.element as HTMLSelectElement).value).toBe('selling');
      expect(target.findAll('option').map((option) => option.text())).not.toContain(
        'Select a question',
      );
      wrapper.unmount();
    });

    it('is a field past 12, under its groups, and typing never drops the answers placed', async () => {
      const wrapper = mount(ElementAssignmentPriority, {
        props: { setupObject: setup(), formFields: [...many, asked(3)] },
        attachTo: document.body,
      });
      await wrapper.get('[data-testid="priority-add-rule"]').trigger('click');
      const input = wrapper.get('[data-testid="priority-target-select-input"]');
      expect(input.attributes('placeholder')).toBe('Select a question');

      await input.setValue('What do');
      await input.trigger('keydown', { key: 'Enter' });
      expect(wrapper.props('setupObject').priority[0]!.target).toBe('selling');

      await wrapper.get('[data-testid="priority-ordering-add"]').setValue('Answer 1');
      await input.setValue('Question');
      await input.trigger('blur');
      expect(wrapper.props('setupObject').priority[0]!.ordering).toEqual(['Answer 1']);
      expect((input.element as HTMLInputElement).value).toBe('What do you sell?');

      // Its own question, chosen again, throws no answer away.
      await input.setValue('What do');
      await input.trigger('keydown', { key: 'Enter' });
      expect(wrapper.props('setupObject').priority[0]!.ordering).toEqual(['Answer 1']);

      await input.setValue('When');
      await input.trigger('keydown', { key: 'Enter' });
      const rule = wrapper.props('setupObject').priority[0]!;
      expect(rule.target).toBe('application.submitted_at');
      expect(rule.ordering).toEqual([]);
      expect(rule.direction).toBe(PriorityDirection.Ascending);
      wrapper.unmount();
    });

    it('is a disabled field on a read-only rule past 12', () => {
      const wrapper = mount(ElementAssignmentPriority, {
        props: {
          setupObject: {
            ...setup(),
            priority: [{ id: 0, target: 'q1', ordering: [], direction: null }],
          } as unknown as SetupObject,
          formFields: [...many, asked(3)],
          readonly: true,
        },
      });
      const input = wrapper.get('[data-testid="priority-target-select-input"]');
      expect(input.attributes()).toHaveProperty('disabled');
      expect((input.element as HTMLInputElement).value).toBe('Question 1');
    });
  });
});
