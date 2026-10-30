/**
 * The organizer sets the automatic rejections (E33/F03/S01).
 *
 * On the review setup step, beside what a reviewer reads first. A rule names one choice question -
 * the server says which, with the answers each offers - and the answers that reject. Every change
 * is the whole list, written at once; once the market has reached Assignment the rules are shown,
 * fixed, with the reason.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import AutomaticRejections from '@/components/application/AutomaticRejections.vue';
import type { RejectionQuestion, RejectionRule } from '@/assets/types/datatypes';

const QUESTIONS: RejectionQuestion[] = [
  {
    key: 'affiliation',
    label: 'Are you a UBC student?',
    answers: ['Current UBC student', 'Not a UBC student'].map((a) => ({ value: a, label: a })),
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
      { key: 'affiliation', answers: ['Not a UBC student'] },
    ]);

    await wrapper.get('[data-testid="rejection-rule-remove-no_shows"]').trigger('click');

    expect(lastWrite(wrapper)).toEqual([{ key: 'affiliation', answers: ['Not a UBC student'] }]);
  });

  it('shows settled rules fixed, saying why', () => {
    const wrapper = mountRules(
      [{ key: 'no_shows', answers: ['not ticked'] }],
      'The automatic rejections are settled: the market has reached Assignment.',
    );

    expect(wrapper.get('[data-testid="rejection-rules-locked"]').text()).toContain('Assignment');
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
