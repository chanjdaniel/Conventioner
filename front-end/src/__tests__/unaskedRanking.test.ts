/**
 * A ranking the market has switched off ("Ask this", E01/F06) is neither shown to an applicant
 * nor required of them (E26/F03/S01).
 *
 * The server always honoured the switch, but the applicant form rendered Section preference
 * whenever the plan had two sections and marked it required, and the client validator demanded a
 * ranking, so the organizer's preview and every online applicant were asked it anyway.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EssentialApplicationFields from '@/components/application/EssentialApplicationFields.vue';
import { SECTION_RANKING_KEY, essentialValidationErrors } from '@/utils/essentialFields';
import type { EssentialFormOptions } from '@/assets/types/datatypes';

const OFFERED: EssentialFormOptions = {
  dates: [],
  sections: ['North', 'South'],
  tableTypes: [],
  tiers: [],
  unasked: [],
};
const SWITCHED_OFF: EssentialFormOptions = { ...OFFERED, unasked: [SECTION_RANKING_KEY] };

function render(options: EssentialFormOptions) {
  return mount(EssentialApplicationFields, {
    props: { options, modelValue: {}, prefix: 'apply' },
  });
}

describe('a switched-off section ranking', () => {
  it('is on the form while the market asks it', () => {
    expect(render(OFFERED).find('[data-testid="apply-essential-section-ranking"]').exists()).toBe(
      true,
    );
  });

  it('is not on the form once the market stops asking it', () => {
    const wrapper = render(SWITCHED_OFF);
    expect(wrapper.find('[data-testid="apply-essential-section-ranking"]').exists()).toBe(false);
  });

  it('is not seeded with an answer the applicant never gave', () => {
    const wrapper = render(SWITCHED_OFF);
    const updates = wrapper.emitted('update:modelValue') ?? [];
    expect(updates.every(([value]) => !(SECTION_RANKING_KEY in (value as object)))).toBe(true);
  });

  it('is not required', () => {
    const errors = essentialValidationErrors(SWITCHED_OFF, { essential_full_name: 'Ada' });
    expect(errors[SECTION_RANKING_KEY]).toBeUndefined();
    expect(
      essentialValidationErrors(OFFERED, { essential_full_name: 'Ada' })[SECTION_RANKING_KEY],
    ).toBeDefined();
  });
});
