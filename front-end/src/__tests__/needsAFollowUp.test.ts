/**
 * An application can need a follow-up, and someone owns it (E34/F02/S01).
 *
 * Skip recorded nothing. "Needs follow-up" is a stored status with an owner, the reviewer unless
 * they name someone else with a role on the market; the queue leaves follow-ups out unless asked,
 * and the reviewed list is only what has a verdict.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import { followUps, reviewQueue, reviewed } from '@/utils/reviewQueue';
import FollowUpDialog from '@/components/application/FollowUpDialog.vue';

const app = (id: string, status: ApplicationStatus, submittedAt: string): Application =>
  ({ id, applicantEmail: `${id}@x.test`, status, submittedAt, formData: {} }) as Application;

const APPS = [
  app('late', ApplicationStatus.Open, '2026-05-03'),
  app('chase', ApplicationStatus.NeedsFollowUp, '2026-05-01'),
  app('early', ApplicationStatus.Open, '2026-05-02'),
  app('done', ApplicationStatus.ReviewerApproved, '2026-05-01'),
];

describe('the review queue', () => {
  it('leaves follow-ups out unless asked, then takes them after the rest', () => {
    expect(reviewQueue(APPS, false).map((a) => a.id)).toEqual(['early', 'late']);
    expect(reviewQueue(APPS, true).map((a) => a.id)).toEqual(['early', 'late', 'chase']);
  });

  it('keeps follow-ups out of what was reviewed', () => {
    expect(reviewed(APPS).map((a) => a.id)).toEqual(['done']);
    expect(followUps(APPS).map((a) => a.id)).toEqual(['chase']);
  });
});

describe('marking a follow-up', () => {
  const PEOPLE = ['alex@market.test', 'sam@market.test'];

  function mountDialog() {
    return mount(FollowUpDialog, {
      props: {
        open: true,
        applicantEmail: 'nadia@ember.test',
        people: PEOPLE,
        me: 'alex@market.test',
      },
      global: { stubs: { teleport: true } },
    });
  }

  it('names the reviewer its owner unless they choose someone else, and takes a note', async () => {
    const wrapper = mountDialog();
    expect(
      (wrapper.get('[data-testid="follow-up-owner"]').element as HTMLSelectElement).value,
    ).toBe('alex@market.test');

    await wrapper.get('[data-testid="follow-up-owner"]').setValue('sam@market.test');
    await wrapper.get('[data-testid="follow-up-note"]').setValue('Ask for a portfolio link');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      ownerEmail: 'sam@market.test',
      note: 'Ask for a portfolio link',
    });
  });
});
