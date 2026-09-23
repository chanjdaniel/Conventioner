import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ReviewHighlights from '@/components/application/ReviewHighlights.vue';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';
import type { FormField } from '@/assets/types/datatypes';

/**
 * The control an organizer marks from, shown on BOTH the form builder and the review queue
 * (E19/F03). The two describe different moments - the plan as it stands, and the offering frozen
 * onto the form - so what they offer can differ while the list they write is one list.
 */
const FIELDS = [
  { key: 'business_name', label: 'Business name', type: 'text', order: 0 },
  { key: 'instagram', label: 'Instagram', type: 'text', order: 1 },
] as unknown as FormField[];

function mountControl(highlights: string[]) {
  return mount(ReviewHighlights, {
    props: { fields: FIELDS, essentialOptions: EMPTY_ESSENTIAL_OPTIONS, highlights },
  });
}

describe('which answers a reviewer reads first', () => {
  it('offers the custom questions and the essential ones the market asks', () => {
    const control = mountControl([]);

    expect(control.find('[data-testid="review-highlight-business_name"]').exists()).toBe(true);
    expect(control.find('[data-testid="review-highlight-essential_full_name"]').exists()).toBe(
      true,
    );
  });

  it('marks in the order they were clicked, because that order is what the card reads down', async () => {
    const control = mountControl(['instagram']);

    await control.find('[data-testid="review-highlight-business_name"] input').setValue(true);

    expect(control.emitted('update:highlights')?.[0]).toEqual([['instagram', 'business_name']]);
  });

  it('unmarking removes only that one', async () => {
    const control = mountControl(['instagram', 'business_name']);

    await control.find('[data-testid="review-highlight-instagram"] input').setValue(false);

    expect(control.emitted('update:highlights')?.[0]).toEqual([['business_name']]);
  });

  it('still offers a marked answer this screen would not otherwise list, so it can be removed', async () => {
    // The builder marked a question against the live plan; the queue sees the FROZEN offering and
    // does not list it. Without this the mark leads every card with no way to take it off - and
    // taking it off from the queue is the whole point of the list living on the market.
    const control = mountControl(['essential_section_ranking']);

    const stray = control.find('[data-testid="review-highlight-essential_section_ranking"]');
    expect(stray.exists()).toBe(true);
    expect(stray.text()).toContain('section ranking');

    await stray.find('input').setValue(false);
    expect(control.emitted('update:highlights')?.[0]).toEqual([[]]);
  });

  it('says so when the market asks nothing at all', () => {
    const control = mount(ReviewHighlights, {
      props: {
        fields: [],
        essentialOptions: {
          ...EMPTY_ESSENTIAL_OPTIONS,
          unasked: [
            'essential_full_name',
            'essential_preferred_name',
            'essential_table_share_email',
          ],
        },
        highlights: [],
      },
    });

    expect(control.find('[data-testid="review-highlights-empty"]').exists()).toBe(true);
  });
});
