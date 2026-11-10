/**
 * The applicant's form on a question of many options (T223): past 12 it is a field to type in, one
 * choice or several as chips, reading and failing like any other question, and at 12 or fewer the
 * select or the checkboxes it always was. The organizer's preview makes the same comparison, and
 * the two organizer's dialogs that ask the same questions work on it unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import AddVendorDialog from '@/components/AddVendorDialog.vue';
import UpdateInfoDialog from '@/components/UpdateInfoDialog.vue';
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue';
import FormPreview from '@/components/application/FormPreview.vue';
import {
  ApplicationStatus,
  ApplicationType,
  type Application,
  type ApplicationForm,
  type FormField,
} from '@/assets/types/datatypes';
import { formValidationErrors } from '@/utils/applicationForm';

const sent: { url: string; body: unknown }[] = [];

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    api: {
      post: (url: string, body: unknown) => {
        sent.push({ url, body });
        return Promise.resolve({ data: { application: { applicantEmail: 'walk.in@fair.test' } } });
      },
      put: (url: string, body: unknown) => {
        sent.push({ url, body });
        return Promise.resolve({ data: { application: {} } });
      },
    },
  };
});

afterEach(() => {
  sent.length = 0;
  document.body.innerHTML = '';
});

const options = (count: number) =>
  Array.from({ length: count }, (_, at) => `Answer ${String(at + 1).padStart(3, '0')}`);

function question(type: 'select' | 'multi_select', count: number, more: Partial<FormField> = {}) {
  return {
    key: 'selling',
    label: 'What do you sell?',
    type,
    required: true,
    options: options(count),
    order: 0,
    ...more,
  } as FormField;
}

const testid = (id: string) => `[data-testid="${id}"]`;

function form(
  field: FormField,
  value: unknown,
  { errors = {}, locked = [] }: { errors?: Record<string, string>; locked?: string[] } = {},
) {
  const answers = ref<Record<string, unknown>>({ [field.key]: value });
  const submitted = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h('form', { onSubmit: (event: Event) => (event.preventDefault(), submitted()) }, [
          h(ApplicationFormFields, {
            fields: [field],
            modelValue: answers.value,
            errors,
            locked,
            'onUpdate:modelValue': (next: Record<string, unknown>) => (answers.value = next),
          }),
          h('button', { type: 'submit', 'data-testid': 'save' }, 'Save'),
        ]),
    }),
    { attachTo: document.body },
  );
  return { wrapper, answers, submitted };
}

const fieldIn = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get<HTMLInputElement>(testid('apply-input-selling-input'));

describe('the question against the threshold', () => {
  it('is the select it was at 12 options', () => {
    const { wrapper } = form(question('select', 12), '');

    const select = wrapper.get(`select${testid('apply-input-selling')}`);
    expect(select.attributes('id')).toBe('apply-selling');
    expect(select.findAll('option')).toHaveLength(13);
    expect(wrapper.find('[role="combobox"]').exists()).toBe(false);
    expect(wrapper.get('label.form-label').attributes('for')).toBe('apply-selling');
    expect(wrapper.get('label.form-label').attributes('aria-hidden')).toBeUndefined();
    wrapper.unmount();
  });

  it('is the checkboxes they were at 12 options', () => {
    const { wrapper } = form(question('multi_select', 12), []);

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(12);
    expect(wrapper.find(testid('apply-input-selling-Answer 001')).exists()).toBe(true);
    expect(wrapper.get('[role="group"]').attributes('aria-labelledby')).toBe('apply-selling-label');
    expect(wrapper.find('[role="combobox"]').exists()).toBe(false);
    wrapper.unmount();
  });

  /** A group of checkboxes is no control a label can point to, so its words are no label. */
  it("names the checkboxes' group by its words, with no label tied to nothing", () => {
    const { wrapper } = form(question('multi_select', 12), []);

    const words = wrapper.get('#apply-selling-label');
    expect(words.element.tagName).toBe('SPAN');
    expect(words.text()).toBe('What do you sell? *');
    expect(words.attributes('aria-hidden')).toBeUndefined();
    expect(wrapper.findAll('label.form-label')).toHaveLength(0);
    // Each checkbox's own label wraps it; no other label stands without a `for`.
    const loose = wrapper
      .findAll('label')
      .filter((label) => !label.attributes('for') && !label.find('input').exists());
    expect(loose).toHaveLength(0);
    expect(wrapper.get('[role="group"]').attributes('aria-labelledby')).toBe('apply-selling-label');
    wrapper.unmount();
  });

  it('is a field past 12, one choice, drawing 50 of what it finds', async () => {
    const { wrapper, answers } = form(question('select', 60), '');

    expect(wrapper.find('select').exists()).toBe(false);
    const field = fieldIn(wrapper);
    await field.trigger('click');
    expect(wrapper.findAll(testid('apply-input-selling-option'))).toHaveLength(50);
    expect(wrapper.get(testid('apply-input-selling-more')).text()).toBe('10 more, type to narrow');

    await field.setValue('answer 042');
    const rows = wrapper.findAll(testid('apply-input-selling-option'));
    expect(rows.map((row) => row.text())).toEqual(['Answer 042']);
    await rows[0]!.trigger('click');

    expect(answers.value.selling).toBe('Answer 042');
    expect(field.element.value).toBe('Answer 042');
    wrapper.unmount();
  });

  it("is a field past 12, several as chips, in the page's flow", async () => {
    const { wrapper, answers } = form(question('multi_select', 13), []);

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.find('.search-picker--list-over').exists()).toBe(false);
    const field = fieldIn(wrapper);
    await field.setValue('013');
    await wrapper.get(testid('apply-input-selling-option')).trigger('click');
    await field.setValue('002');
    await wrapper.get(testid('apply-input-selling-option')).trigger('click');

    expect(answers.value.selling).toEqual(['Answer 013', 'Answer 002']);
    expect(wrapper.findAll(testid('apply-input-selling-chip')).map((chip) => chip.text())).toEqual([
      'Answer 013Remove Answer 013',
      'Answer 002Remove Answer 002',
    ]);
    await wrapper.get(testid('apply-input-selling-chip-remove')).trigger('click');
    expect(answers.value.selling).toEqual(['Answer 002']);
    wrapper.unmount();
  });
});

describe('one label, heard once', () => {
  for (const type of ['select', 'multi_select'] as const) {
    it(`names a ${type}'s field once, as its question, required mark and all`, () => {
      const { wrapper } = form(question(type, 13), type === 'select' ? '' : []);

      const field = fieldIn(wrapper).element;
      expect(field.id).toBe('apply-selling');
      // Only one label reaches the field, so its name is the question's words once.
      expect([...field.labels!].map((label) => label.textContent)).toEqual(['What do you sell? *']);
      // The question's own words stand for the eye, and a reader skips them for the field's.
      const seen = wrapper.get('span.form-label');
      expect(seen.text()).toBe('What do you sell? *');
      expect(seen.attributes('for')).toBeUndefined();
      expect(seen.attributes('aria-hidden')).toBe('true');
      wrapper.unmount();
    });

    it(`has the caret in a ${type}'s field on a press of its question's words`, async () => {
      const { wrapper } = form(question(type, 13), type === 'select' ? '' : []);

      await wrapper.get('span.form-label').trigger('click');

      expect(document.activeElement).toBe(fieldIn(wrapper).element);
      wrapper.unmount();
    });
  }

  it('names a plain question of an optional kind without the mark', () => {
    const { wrapper } = form(question('select', 13, { required: false }), '');

    expect([...fieldIn(wrapper).element.labels!].map((label) => label.textContent)).toEqual([
      'What do you sell?',
    ]);
    wrapper.unmount();
  });
});

describe('locked and in error', () => {
  it('takes nothing while locked, with its chips', () => {
    const { wrapper } = form(question('multi_select', 13), ['Answer 001'], {
      locked: ['selling'],
    });

    expect(fieldIn(wrapper).attributes('disabled')).toBeDefined();
    expect(
      wrapper.get(testid('apply-input-selling-chip-remove')).attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('says "No answer chosen" locked with none, for nothing may be found there', () => {
    const { wrapper } = form(question('select', 13), '', { locked: ['selling'] });

    expect(fieldIn(wrapper).attributes('placeholder')).toBe('No answer chosen');
    wrapper.unmount();
  });

  it('reads as in error, and a reader hears why', () => {
    const { wrapper } = form(question('select', 13), '', {
      errors: { selling: '"What do you sell?" is required.' },
    });

    const field = fieldIn(wrapper);
    expect(field.attributes('aria-invalid')).toBe('true');
    const error = wrapper.get(testid('apply-error-selling'));
    expect(error.attributes('id')).toBe(field.attributes('aria-describedby'));
    expect(error.text()).toBe('"What do you sell?" is required.');
    wrapper.unmount();
  });

  it("adds nothing to a short question's error", () => {
    const { wrapper } = form(question('select', 12), '', { errors: { selling: 'Required.' } });

    expect(wrapper.get(testid('apply-error-selling')).attributes('id')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('words not chosen', () => {
  it('clear on leaving one choice, and are no answer', async () => {
    const { wrapper, answers } = form(question('select', 60), '');

    const field = fieldIn(wrapper);
    await field.setValue('not an answer');
    await field.trigger('blur');

    expect(field.element.value).toBe('');
    expect(answers.value.selling).toBe('');
    wrapper.unmount();
  });

  it('clear on leaving several, and are no chip', async () => {
    const { wrapper, answers } = form(question('multi_select', 60), ['Answer 001']);

    const field = fieldIn(wrapper);
    await field.setValue('not an answer');
    await field.trigger('blur');

    expect(field.element.value).toBe('');
    expect(answers.value.selling).toEqual(['Answer 001']);
    wrapper.unmount();
  });

  it('let the choice go as they are typed, so a submit never holds them', async () => {
    const { wrapper, answers } = form(question('select', 60), 'Answer 001');

    const field = fieldIn(wrapper);
    await field.setValue('Answer 00');
    expect(answers.value.selling).toBe('');
    await field.setValue('nothing it offers');
    // Enter with the words finding nothing only closes the list.
    await field.trigger('keydown', { key: 'Enter' });
    await field.trigger('keydown', { key: 'Enter' });

    expect(answers.value.selling).toBe('');
    expect(formValidationErrors([question('select', 60)], answers.value)).toEqual({
      selling: '"What do you sell?" is required.',
    });
    wrapper.unmount();
  });
});

describe('an answer no option offers', () => {
  it('is a chip among several', () => {
    const { wrapper } = form(question('multi_select', 60), ['Answer 001', 'Gone by now']);

    expect(wrapper.findAll(testid('apply-input-selling-chip')).map((chip) => chip.text())).toEqual([
      'Answer 001Remove Answer 001',
      'Gone by nowRemove Gone by now',
    ]);
    wrapper.unmount();
  });

  it("leaves one choice's field empty", () => {
    const { wrapper } = form(question('select', 60), 'Gone by now');

    expect(fieldIn(wrapper).element.value).toBe('');
    wrapper.unmount();
  });

  for (const count of [12, 60]) {
    it(`has the required check speak on one choice of ${count}, as its field shows no answer`, () => {
      expect(formValidationErrors([question('select', count)], { selling: 'Gone by now' })).toEqual(
        { selling: '"What do you sell?" is required.' },
      );
    });
  }

  it('leaves an optional question to the server, as it was', () => {
    expect(
      formValidationErrors([question('select', 60, { required: false })], {
        selling: 'Gone by now',
      }),
    ).toEqual({});
  });

  it('takes an offered answer as an answer', () => {
    expect(formValidationErrors([question('select', 60)], { selling: 'Answer 007' })).toEqual({});
  });
});

describe('Enter', () => {
  it('takes the choice with the list open, and never submits', async () => {
    const { wrapper, answers, submitted } = form(question('select', 60), '');

    const field = fieldIn(wrapper);
    await field.setValue('Answer 042');
    const pressed = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    field.element.dispatchEvent(pressed);
    await nextTick();

    expect(pressed.defaultPrevented).toBe(true);
    expect(answers.value.selling).toBe('Answer 042');
    expect(submitted).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('goes on to the form with the list closed', async () => {
    const { wrapper } = form(question('select', 60), 'Answer 001');

    const pressed = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fieldIn(wrapper).element.dispatchEvent(pressed);
    await nextTick();

    // Nothing stops the key, so the browser's own implicit submission goes on as it did.
    expect(pressed.defaultPrevented).toBe(false);
    wrapper.unmount();
  });
});

describe("the organizer's preview", () => {
  const previewed = (field: FormField) =>
    mount(FormPreview, { props: { applicationForm: { fields: [field] } as ApplicationForm } });

  it('is the select and the checkboxes it was at 12', () => {
    const select = previewed(question('select', 12));
    expect(select.find('select#preview-selling').exists()).toBe(true);
    expect(select.get('label.preview-label').attributes('for')).toBe('preview-selling');
    expect(select.find('[role="combobox"]').exists()).toBe(false);

    const several = previewed(question('multi_select', 12));
    expect(several.findAll('input[type="checkbox"]')).toHaveLength(12);
    expect(several.find('[role="combobox"]').exists()).toBe(false);
  });

  for (const type of ['select', 'multi_select'] as const) {
    it(`shows a ${type} past 12 as the applicant gets it, disabled, named once`, () => {
      const wrapper = previewed(question(type, 13));

      const field = wrapper.get<HTMLInputElement>(testid('form-preview-input-selling-input'));
      expect(field.attributes('disabled')).toBeDefined();
      expect(field.attributes('role')).toBe('combobox');
      // What an applicant will read there, though nothing may be typed here.
      expect(field.attributes('placeholder')).toBe('Find an answer');
      expect(field.attributes('id')).toBe('preview-selling');
      expect(wrapper.find('select').exists()).toBe(false);
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
      const seen = wrapper.get('span.preview-label');
      expect(seen.attributes('for')).toBeUndefined();
      expect(seen.attributes('aria-hidden')).toBe('true');
    });
  }
});

describe('the dialogs that ask the same questions', () => {
  it('adds a vendor by a long question of each kind, found by typing', async () => {
    const wrapper = mount(AddVendorDialog, {
      props: {
        open: true,
        marketId: 'market-123',
        form: {
          fields: [
            question('select', 60),
            question('multi_select', 60, { key: 'clubs', label: 'Clubs', order: 1 }),
          ],
        } as ApplicationForm,
        priceReads: ['selling', 'clubs'],
      },
      attachTo: document.body,
    });
    await wrapper.get(testid('add-vendor-name-input')).setValue('Walk-in Wares');
    await wrapper.get(testid('add-vendor-email-input')).setValue('walk.in@fair.test');
    const add = wrapper.get(testid('add-vendor-submit-button'));
    expect(add.attributes('disabled')).toBeDefined();

    const selling = wrapper.get(testid('add-vendor-input-selling-input'));
    await selling.setValue('Answer 042');
    await wrapper.get(testid('add-vendor-input-selling-option')).trigger('click');
    const clubs = wrapper.get(testid('add-vendor-input-clubs-input'));
    await clubs.setValue('Answer 007');
    await wrapper.get(testid('add-vendor-input-clubs-option')).trigger('click');

    expect(add.attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({
      answers: { selling: 'Answer 042', clubs: ['Answer 007'] },
    });
    wrapper.unmount();
  });

  function application(formData: Record<string, unknown>): Application {
    return {
      id: 'app-1',
      marketId: 'market-123',
      applicantEmail: 'nadia@ember.test',
      formData,
      status: ApplicationStatus.Open,
      applicationType: ApplicationType.Main,
      updatedAt: '2026-10-01T00:00:00Z',
    } as Application;
  }

  function updating(formData: Record<string, unknown>, assignmentRefusal: string | null = null) {
    return mount(UpdateInfoDialog, {
      props: {
        open: true,
        marketId: 'market-123',
        application: application(formData),
        form: {
          fields: [
            question('select', 60),
            question('multi_select', 60, { key: 'clubs', label: 'Clubs', order: 1 }),
          ],
        } as ApplicationForm,
        options: { dates: [], tiers: [], sections: [], tableTypes: [] },
        assignmentRefusal,
        priceReads: ['selling'],
      },
      attachTo: document.body,
    });
  }

  it("updates a vendor's long answers, saying what they wrote", async () => {
    const wrapper = updating({ selling: 'Answer 001', clubs: ['Answer 002'] });

    const selling = wrapper.get<HTMLInputElement>(testid('update-info-input-selling-input'));
    expect(selling.element.value).toBe('Answer 001');
    await selling.setValue('Answer 042');
    await wrapper.get(testid('update-info-input-selling-option')).trigger('click');
    const clubs = wrapper.get(testid('update-info-input-clubs-input'));
    await clubs.setValue('Answer 007');
    await wrapper.get(testid('update-info-input-clubs-option')).trigger('click');

    expect(wrapper.get(testid('update-info-answer-selling')).text()).toContain('Answer 001');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({
      answers: { selling: 'Answer 042', clubs: ['Answer 002', 'Answer 007'] },
    });
    wrapper.unmount();
  });

  it('shows a long answer a price reads read-only, to one who may not update it', () => {
    const wrapper = updating({ selling: 'Answer 001' }, 'Only an Admin may update it.');

    const selling = wrapper.get<HTMLInputElement>(testid('update-info-input-selling-input'));
    expect(selling.attributes('disabled')).toBeDefined();
    expect(selling.element.value).toBe('Answer 001');
    wrapper.unmount();
  });
});
