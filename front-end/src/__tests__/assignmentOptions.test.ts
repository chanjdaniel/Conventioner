// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import ElementAssignmentOptions from '@/components/elements/ElementAssignmentOptions.vue';
import type { SetupObject } from '@/assets/types/datatypes';

function setup(dateCount: number): SetupObject {
  return {
    priority: [],
    marketDates: Array.from({ length: dateCount }, (_, i) => ({
      date: `2026-05-0${i + 1}`,
    })),
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
    },
  } as unknown as SetupObject;
}

function mountOptions(dateCount = 3) {
  return mount(ElementAssignmentOptions, { props: { setupObject: setup(dateCount) } });
}

async function enterMaxAssignments(wrapper: ReturnType<typeof mountOptions>, value: string) {
  const input = wrapper.find('[data-testid="setup-options-max-assignments-input"]');
  await input.setValue(value);
  return wrapper.props('setupObject').assignmentOptions.maxAssignmentsPerVendor;
}

describe('ElementAssignmentOptions: max assignments per vendor', () => {
  it('keeps an ordinary value', async () => {
    expect(await enterMaxAssignments(mountOptions(), '2')).toBe(2);
  });

  it('clamps a value above the number of market dates', async () => {
    expect(await enterMaxAssignments(mountOptions(3), '9')).toBe(3);
  });

  it('leaves a negative value unset, as it always has', async () => {
    expect(await enterMaxAssignments(mountOptions(), '-1')).toBeNull();
  });

  it('leaves zero unset rather than storing a cap that assigns nobody', async () => {
    expect(await enterMaxAssignments(mountOptions(), '0')).toBeNull();
  });

  it('leaves a non-number unset', async () => {
    expect(await enterMaxAssignments(mountOptions(), 'abc')).toBeNull();
  });
});

describe('ElementAssignmentOptions, read-only (E22/F02/S02)', () => {
  it('shows both options as they were run, and neither can be edited', () => {
    const wrapper = mount(ElementAssignmentOptions, {
      props: { setupObject: setup(3), readonly: true },
    });

    for (const input of [
      'setup-options-max-assignments-input',
      'setup-options-max-proportion-input',
    ]) {
      expect(wrapper.find(`[data-testid="${input}"]`).attributes(), input).toHaveProperty(
        'disabled',
      );
    }
  });
});
