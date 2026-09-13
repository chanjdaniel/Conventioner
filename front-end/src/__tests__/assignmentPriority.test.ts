// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

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
    colNames: [],
    colValues: [],
    colInclude: [],
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

      expect(wrapper.find('[data-testid="priority-direction"]').exists()).toBe(true);
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
