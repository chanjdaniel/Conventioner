/**
 * A vendor as a choice in a `SearchPicker` (T223): the one row history's vendor field and the
 * placement dialog's pickers draw.
 */
import { describe, expect, it } from 'vitest';

import { vendorLabel, vendorOption } from '@/utils/personChoice';

const NAMES = { 'ana-maria@ember.test': 'Ana Rivera' };

describe('vendorOption', () => {
  it('calls a vendor by name beside the address, and marks the label as holding an address', () => {
    expect(vendorOption('ana-maria@ember.test', NAMES)).toEqual({
      value: 'ana-maria@ember.test',
      label: 'Ana Rivera (ana-maria@ember.test)',
      address: true,
    });
  });

  it('calls a vendor with no name by the address alone', () => {
    expect(vendorOption('cy@ember.test', NAMES)).toEqual({
      value: 'cy@ember.test',
      label: 'cy@ember.test',
      address: true,
    });
  });

  it('finds the name whatever the capitals of the address, keeping the value as given', () => {
    const option = vendorOption('Ana-Maria@Ember.test', NAMES);
    expect(option.value).toBe('Ana-Maria@Ember.test');
    expect(option.label).toBe('Ana Rivera (Ana-Maria@Ember.test)');
  });
});

describe('vendorLabel', () => {
  it('reads nothing for no address at all', () => {
    expect(vendorLabel(null, NAMES)).toBe('');
    expect(vendorLabel(undefined, NAMES)).toBe('');
  });

  it('trims what it was given', () => {
    expect(vendorLabel(' ana-maria@ember.test ', NAMES)).toBe('Ana Rivera (ana-maria@ember.test)');
  });
});
