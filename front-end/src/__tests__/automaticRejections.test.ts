/**
 * The organizer sets the automatic rejections (E33/F03/S01).
 *
 * On the review setup step, beside what a reviewer reads first. A rule names one choice question -
 * the server says which, with the answers each offers - and the answers that reject. Every change
 * is the whole list, written at once; once the review is closed the rules are shown, fixed, with
 * the server's reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import AutomaticRejections from '@/components/application/AutomaticRejections.vue';
import type { RejectionQuestion, RejectionRule } from '@/assets/types/datatypes';

const QUESTIONS: RejectionQuestion[] = [
  {
    key: 'affiliation',
    label: 'Are you an Example College student?',
    answers: ['Current Example College student', 'Not an Example College student'].map((a) => ({
      value: a,
      label: a,
    })),
  },
  {
    key: 'no_shows',
    label: 'I understand that no-shows',
    answers: [
      { value: 'ticked', label: 'Ticked' },
      { value: 'not ticked', label: 'Not ticked' },
    ],
  },
];

function mountRules(rules: RejectionRule[], lockReason: string | null = null) {
  return mount(AutomaticRejections, { props: { questions: QUESTIONS, rules, lockReason } });
}

const lastWrite = (wrapper: ReturnType<typeof mountRules>) =>
  (wrapper.emitted('update:rules') ?? []).at(-1)?.[0];

describe('the automatic rejections', () => {
  it('adds a rule on a question, then ticks the answer that rejects', async () => {
    const wrapper = mountRules([]);

    await wrapper.get('[data-testid="rejection-rule-question"]').setValue('no_shows');
    await wrapper.get('[data-testid="rejection-rule-add"]').trigger('click');
    expect(lastWrite(wrapper)).toEqual([{ key: 'no_shows', answers: [] }]);

    await wrapper.setProps({ rules: [{ key: 'no_shows', answers: [] }] });
    await wrapper.get('[data-testid="rejection-answer-no_shows-not ticked"] input').setValue(true);
    expect(lastWrite(wrapper)).toEqual([{ key: 'no_shows', answers: ['not ticked'] }]);
  });

  it('offers only questions without a rule yet', async () => {
    const wrapper = mountRules([{ key: 'no_shows', answers: ['not ticked'] }]);

    const offered = wrapper
      .findAll('[data-testid="rejection-rule-question"] option')
      .map((o) => o.attributes('value'))
      .filter(Boolean);
    expect(offered).toEqual(['affiliation']);
  });

  it('removes a rule', async () => {
    const wrapper = mountRules([
      { key: 'no_shows', answers: ['not ticked'] },
      { key: 'affiliation', answers: ['Not an Example College student'] },
    ]);

    await wrapper.get('[data-testid="rejection-rule-remove-no_shows"]').trigger('click');

    expect(lastWrite(wrapper)).toEqual([
      { key: 'affiliation', answers: ['Not an Example College student'] },
    ]);
  });

  it('shows settled rules fixed, saying why', () => {
    const wrapper = mountRules(
      [{ key: 'no_shows', answers: ['not ticked'] }],
      'The automatic rejections closed when results were published.',
    );

    expect(wrapper.get('[data-testid="rejection-rules-locked"]').text()).toBe(
      'The automatic rejections closed when results were published.',
    );
    expect(wrapper.find('[data-testid="rejection-rule-add"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="rejection-rule-remove-no_shows"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-testid="rejection-answer-no_shows-not ticked"] input').attributes(),
    ).toHaveProperty('disabled');
  });
});

describe('who may overturn an automatic rejection (E38/F06/S01)', () => {
  it('is named from the market table, as its row stands', () => {
    const wrapper = mount(AutomaticRejections, {
      props: {
        questions: QUESTIONS,
        rules: [],
        lockReason: null,
        overturnedBy: 'an Admin or the owner',
      },
    });

    expect(wrapper.get('.rejections-help').text()).toContain(
      'An Admin or the owner can overturn it, and the applicant never sees the reason.',
    );
  });

  it('names nobody when the market read carries no such row', () => {
    const help = mountRules([]).get('.rejections-help').text();

    expect(help).not.toContain('overturn');
    expect(help).toContain('The applicant never sees the reason.');
  });
});

/** A question whose answers pass the threshold, and one that stops at it. */
const answers = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    value: `Answer ${at + 1}`,
    label: `Answer ${at + 1}`,
  }));
const AT_THE_THRESHOLD: RejectionQuestion = {
  key: 'twelve',
  label: 'Twelve',
  answers: answers(12),
};
const PAST_IT: RejectionQuestion = { key: 'selling', label: 'What you sell', answers: answers(13) };

function mountLong(rules: RejectionRule[], lockReason: string | null = null) {
  return mount(AutomaticRejections, {
    props: { questions: [AT_THE_THRESHOLD, PAST_IT], rules, lockReason },
    attachTo: document.body,
  });
}

const PICKER = '[data-testid="rejection-answers-selling"]';
const picked = (wrapper: ReturnType<typeof mountLong>) =>
  wrapper.findAll(`${PICKER} [data-testid="rejection-answers-selling-chip"]`).map((c) => c.text());

describe('a rule on a question of many answers', () => {
  it('stays the checkboxes at 12 answers, and is a field to type in at 13', () => {
    const wrapper = mountLong([
      { key: 'twelve', answers: ['Answer 2'] },
      { key: 'selling', answers: [] },
    ]);

    const twelve = wrapper.get('[data-testid="rejection-rule-twelve"]');
    expect(twelve.findAll('input[type="checkbox"]')).toHaveLength(12);
    expect(twelve.get('[data-testid="rejection-answer-twelve-Answer 2"]').classes()).toContain(
      'meets',
    );
    expect(wrapper.find('[data-testid="rejection-answers-twelve"]').exists()).toBe(false);

    const selling = wrapper.get('[data-testid="rejection-rule-selling"]');
    expect(selling.findAll('input[type="checkbox"]')).toHaveLength(0);
    const label = wrapper.get(`${PICKER} label`);
    expect(label.text()).toBe('Answers to What you sell');
    expect(label.classes()).toContain('visually-hidden');
    expect(label.attributes('for')).toBe(wrapper.get(`${PICKER} input`).attributes('id'));
  });

  it('caps its list at 50 of what the words find, and finds by a word', async () => {
    const wrapper = mount(AutomaticRejections, {
      props: {
        questions: [{ ...PAST_IT, answers: answers(60) }],
        rules: [{ key: 'selling', answers: [] }],
        lockReason: null,
      },
      attachTo: document.body,
    });

    await wrapper.get(`${PICKER} input`).trigger('click');
    expect(wrapper.findAll(`${PICKER} [role="option"]`)).toHaveLength(50);
    expect(wrapper.get('[data-testid="rejection-answers-selling-more"]').text()).toContain(
      '10 more',
    );

    await wrapper.get(`${PICKER} input`).setValue('answer 59');
    expect(wrapper.findAll(`${PICKER} [role="option"]`).map((row) => row.text())).toEqual([
      'Answer 59',
    ]);
  });

  it('writes the whole list of rules on a choice, a chip taken away and Backspace', async () => {
    const other = { key: 'twelve', answers: ['Answer 2'] };
    const wrapper = mountLong([other, { key: 'selling', answers: ['Answer 1'] }]);
    expect(picked(wrapper)[0]).toContain('Answer 1');

    await wrapper.get(`${PICKER} input`).setValue('Answer 13');
    await wrapper.get(`${PICKER} [data-value="Answer 13"]`).trigger('click');
    expect(lastWrite(wrapper)).toEqual([
      other,
      { key: 'selling', answers: ['Answer 1', 'Answer 13'] },
    ]);

    await wrapper.setProps({
      rules: [other, { key: 'selling', answers: ['Answer 1', 'Answer 13'] }],
    });
    await wrapper
      .findAll('[data-testid="rejection-answers-selling-chip-remove"]')[0]!
      .trigger('click');
    expect(lastWrite(wrapper)).toEqual([other, { key: 'selling', answers: ['Answer 13'] }]);

    await wrapper.setProps({ rules: [other, { key: 'selling', answers: ['Answer 13'] }] });
    await wrapper.get(`${PICKER} input`).setValue('');
    await wrapper.get(`${PICKER} input`).trigger('keydown', { key: 'Backspace' });
    expect(lastWrite(wrapper)).toEqual([other, { key: 'selling', answers: [] }]);
  });

  it('shown fixed, its answers read as chips with nothing to remove them and no field', () => {
    const wrapper = mountLong(
      [{ key: 'selling', answers: ['Answer 3', 'Answer 13'] }],
      'The automatic rejections closed when results were published.',
    );

    expect(picked(wrapper)).toEqual(['Answer 3', 'Answer 13']);
    expect(
      wrapper.get('[data-testid="rejection-answers-selling-chips"]').attributes('aria-label'),
    ).toBe('Answers to What you sell, chosen');
    expect(wrapper.find(`${PICKER} input`).exists()).toBe(false);
    expect(wrapper.find(`${PICKER} button`).exists()).toBe(false);
    expect(wrapper.find('[data-testid="rejection-answers-selling-chip-remove"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('.conditions-empty').exists()).toBe(false);
  });

  it('shown fixed, two chosen answers that read alike are two chips, each keyed by its value', async () => {
    // An answer valued "ceramics" reads "Ceramics", and a gone answer is spelt "Ceramics" too.
    const question: RejectionQuestion = {
      key: 'selling',
      label: 'What you sell',
      answers: [
        { value: 'ceramics', label: 'Ceramics' },
        ...answers(12).map((answer) => ({ ...answer, value: answer.value.toLowerCase() })),
      ],
    };
    const lockReason = 'The automatic rejections closed when results were published.';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapper = mount(AutomaticRejections, {
        props: {
          questions: [question],
          rules: [{ key: 'selling', answers: ['answer 1', 'answer 2'] }],
          lockReason,
        },
        attachTo: document.body,
      });
      // Vue checks a list's keys as it patches it, so the chips are drawn again, all new.
      await wrapper.setProps({
        rules: [{ key: 'selling', answers: ['answer 3', 'ceramics', 'Ceramics', 'answer 4'] }],
      });

      expect(picked(wrapper)).toEqual(['Answer 3', 'Ceramics', 'Ceramics', 'Answer 4']);
      expect(warn.mock.calls.flat().join(' ')).not.toContain('Duplicate keys');
      wrapper.unmount();
    } finally {
      warn.mockRestore();
    }
  });

  it('fixed with no answer chosen, says so in words and draws no field', () => {
    const wrapper = mountLong(
      [{ key: 'selling', answers: [] }],
      'The automatic rejections closed when results were published.',
    );

    expect(wrapper.get('[data-testid="rejection-answers-selling-none"]').text()).toBe(
      'No answer chosen',
    );
    expect(wrapper.find(`${PICKER} input`).exists()).toBe(false);
    expect(picked(wrapper)).toEqual([]);
  });

  it('an answer the form no longer offers is a chip of its own words, and the line names it', async () => {
    const wrapper = mountLong([{ key: 'selling', answers: ['Answer 1', 'Candles'] }]);

    expect(picked(wrapper).some((chip) => chip.startsWith('Candles'))).toBe(true);
    const line = wrapper.get('[data-testid="rejection-broken-selling"]');
    expect(line.text()).toContain('The form no longer offers "Candles"');
    expect(line.text()).toContain('Remove its chip, or remove this rule.');
    expect(wrapper.get('[data-testid="rejection-rule-selling"]').classes()).toContain('broken');

    const chipFor = wrapper
      .findAll('[data-testid="rejection-answers-selling-chip"]')
      .find((chip) => chip.text().startsWith('Candles'))!;
    await chipFor.get('button').trigger('click');
    const next = lastWrite(wrapper) as RejectionRule[];
    expect(next).toEqual([{ key: 'selling', answers: ['Answer 1'] }]);

    await wrapper.setProps({ rules: next });
    expect(wrapper.find('[data-testid="rejection-broken-selling"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="rejection-rule-selling"]').classes()).not.toContain('broken');
  });

  it('with no answer chosen, says what a rule with none does', () => {
    const wrapper = mountLong([{ key: 'selling', answers: [] }]);

    expect(wrapper.get('[data-testid="rejection-rule-selling"]').text()).toContain(
      'Until one is ticked, this rule rejects nobody.',
    );
  });
});

describe('"Add a rule on"', () => {
  const many = Array.from({ length: 13 }, (_, at) => ({
    key: `q${at}`,
    label: `Question ${at}`,
    answers: answers(2),
  }));

  it('is a select at 12 questions, and Add takes what it holds', async () => {
    const wrapper = mount(AutomaticRejections, {
      props: { questions: many.slice(0, 12), rules: [], lockReason: null },
    });
    const select = wrapper.get('select[data-testid="rejection-rule-question"]');
    expect(select.find('option').text()).toBe('Choose a question');
    expect(wrapper.get('[data-testid="rejection-rule-add"]').attributes()).toHaveProperty(
      'disabled',
    );

    await select.setValue('q3');
    await wrapper.get('[data-testid="rejection-rule-add"]').trigger('click');
    expect(lastWrite(wrapper)).toEqual([{ key: 'q3', answers: [] }]);
    // Ready for the next.
    expect((select.element as HTMLSelectElement).value).toBe('');
  });

  it('is a field to type in at 13, and Add takes the question found', async () => {
    const wrapper = mount(AutomaticRejections, {
      props: { questions: many, rules: [], lockReason: null },
      attachTo: document.body,
    });
    const field = wrapper.get('[data-testid="rejection-rule-question-input"]');
    expect(wrapper.find('select').exists()).toBe(false);

    await field.setValue('question 11');
    await wrapper
      .get('[data-testid="rejection-rule-question"] [data-value="q11"]')
      .trigger('click');
    await wrapper.get('[data-testid="rejection-rule-add"]').trigger('click');

    expect(lastWrite(wrapper)).toEqual([{ key: 'q11', answers: [] }]);
    expect((field.element as HTMLInputElement).value).toBe('');
  });

  it('stays the field as rules use the questions up, since it counts them all', () => {
    const wrapper = mount(AutomaticRejections, {
      props: {
        questions: many,
        rules: many.slice(0, 5).map((question) => ({ key: question.key, answers: [] })),
        lockReason: null,
      },
    });

    expect(wrapper.find('[data-testid="rejection-rule-question-input"]').exists()).toBe(true);
  });
});
