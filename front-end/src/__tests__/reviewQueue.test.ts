import { describe, expect, it } from 'vitest';

import type { Application, ApplicationForm } from '@/assets/types/datatypes';
import { asksNothingDistinguishing, reviewAnswers } from '@/utils/reviewQueue';

function application(formData: Record<string, unknown>): Application {
  return {
    id: 'app-1',
    marketId: 'market-1',
    applicantEmail: 'vendor@example.com',
    formData,
    status: 'submitted',
    applicationType: 'main',
    updatedAt: '2026-01-01T00:00:00Z',
  } as Application;
}

function form(fields: Array<{ key: string; label: string }>): ApplicationForm {
  return {
    fields: fields.map((f, order) => ({
      ...f,
      type: 'text',
      required: false,
      options: [],
      order,
    })),
  };
}

describe('reviewAnswers', () => {
  it('shows the organizer’s own questions first, since those are what differ between applicants', () => {
    const answers = reviewAnswers(
      application({
        essential_max_dates: 2,
        what_do_you_sell: 'Enamel pins',
      }),
      form([{ key: 'what_do_you_sell', label: 'What do you sell?' }]),
    );

    expect(answers.map((a) => a.key)).toEqual(['what_do_you_sell', 'essential_max_dates']);
    expect(answers[0]).toMatchObject({
      label: 'What do you sell?',
      value: 'Enamel pins',
      custom: true,
    });
    expect(answers[1]).toMatchObject({
      label: 'Number of dates you want',
      value: '2',
      custom: false,
    });
  });

  it('renders the per-date tier answer rather than [object Object]', () => {
    const [answer] = reviewAnswers(
      application({ essential_tier_preference: { '2026-05-01': ['Gold', 'Silver'] } }),
    );

    expect(answer.value).toContain('Gold, Silver');
    expect(answer.value).not.toContain('object Object');
  });

  it('formats available dates the way the applicant read them back, year included', () => {
    const [answer] = reviewAnswers(application({ essential_available_dates: ['2026-05-01'] }));

    // Whole, not by substring: `toContain('2026')` is what let the doubled year reach the review
    // queue and survive a green suite (E14/F01/S01).
    expect(answer.value).toBe('Friday, May 1, 2026');
  });

  it('reads a table choice back as the sentence, not the stored code', () => {
    const [answer] = reviewAnswers(application({ essential_table_choice: 'half' }));

    expect(answer.value).not.toBe('half');
    expect(answer.value.toLowerCase()).toContain('half');
  });

  it('keeps a ranking numbered, so a preference does not read as a plain list', () => {
    const [answer] = reviewAnswers(
      application({ essential_section_ranking: ['Front Row', 'Middle'] }),
    );

    expect(answer.value).toBe('1. Front Row · 2. Middle');
  });

  it('lists the organizer’s questions in the order the form declares, not storage order', () => {
    const answers = reviewAnswers(application({ second: 'b', first: 'a' }), {
      fields: [
        { key: 'first', label: 'First', type: 'text', required: false, options: [], order: 0 },
        { key: 'second', label: 'Second', type: 'text', required: false, options: [], order: 1 },
      ],
    });

    expect(answers.map((a) => a.key)).toEqual(['first', 'second']);
  });

  it('still shows an essential answer this build does not know about', () => {
    const [answer] = reviewAnswers(application({ essential_something_new: 'kept' }));

    expect(answer).toMatchObject({ value: 'kept', custom: false });
  });

  it('drops a blank answer, because an unanswered optional question is not information', () => {
    const answers = reviewAnswers(
      application({ portfolio: '   ', what_do_you_sell: 'Pins' }),
      form([
        { key: 'portfolio', label: 'Portfolio' },
        { key: 'what_do_you_sell', label: 'What do you sell?' },
      ]),
    );

    expect(answers.map((a) => a.key)).toEqual(['what_do_you_sell']);
  });

  it('still shows an answer whose question the form no longer names', () => {
    const [answer] = reviewAnswers(application({ old_question: 'kept' }), form([]));

    expect(answer).toMatchObject({ label: 'old question', value: 'kept' });
  });

  it('holds no answer the application did not carry', () => {
    expect(reviewAnswers(application({}), form([{ key: 'a', label: 'A' }]))).toEqual([]);
  });
});

describe('asksNothingDistinguishing', () => {
  it('is true for a form of essential questions alone, where every card reads the same', () => {
    expect(asksNothingDistinguishing(form([]))).toBe(true);
    expect(asksNothingDistinguishing(null)).toBe(true);
  });

  it('is false once the organizer asks anything of their own', () => {
    expect(asksNothingDistinguishing(form([{ key: 'a', label: 'A' }]))).toBe(false);
  });
});
