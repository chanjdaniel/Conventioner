import { describe, it, expect } from 'vitest';

import { applicationFormError, applicationFormHint } from '@/utils/applicationForm';
import type { ApplicationForm, FormField } from '@/assets/types/datatypes';

function field(overrides: Partial<FormField> = {}): FormField {
  return {
    key: 'shop_name',
    label: 'Shop Name',
    type: 'text',
    required: false,
    options: [],
    order: 0,
    ...overrides,
  };
}

function form(...fields: FormField[]): ApplicationForm {
  return { fields };
}

describe('applicationFormHint', () => {
  it('explains why Save is disabled on a form with no fields', () => {
    expect(applicationFormHint(null)).toBe('Add at least one field to save this form.');
    expect(applicationFormHint(form())).toBe('Add at least one field to save this form.');
  });

  it('explains why Save is disabled while a just-added field is untouched', () => {
    const added = field({ key: '', label: '' });

    expect(applicationFormHint(form(added))).toBe('Give every field a label to save this form.');
  });

  it('stays quiet once every field is filled in', () => {
    expect(applicationFormHint(form(field()))).toBeNull();
  });
});

describe('applicationFormError', () => {
  it('does not scold a just-added field the organizer has not typed into yet', () => {
    const added = field({ key: '', label: '' });

    expect(applicationFormError(form(added))).toBeNull();
  });

  it('flags a field left without a label once its key is set', () => {
    const started = field({ key: 'shop_name', label: '  ' });

    expect(applicationFormError(form(started))).toBe('Field "shop_name" needs a label.');
  });

  it('flags a labelled field whose key was cleared', () => {
    expect(applicationFormError(form(field({ key: '' })))).toBe('Field "Shop Name" needs a key.');
  });

  it('rejects keys outside the charset the back-end persists', () => {
    expect(applicationFormError(form(field({ key: 'shop.name' })))).toContain(
      'Key "shop.name" is invalid',
    );
    expect(applicationFormError(form(field({ key: '$where' })))).toContain('is invalid');
  });

  it('rejects duplicate keys, which would collide as answer keys', () => {
    const dupe = form(field(), field({ label: 'Other', order: 1 }));

    expect(applicationFormError(dupe)).toBe(
      'Duplicate field key "shop_name". Keys must be unique.',
    );
  });

  it('requires select fields to offer an option', () => {
    const empty = field({ type: 'select', options: [] });

    expect(applicationFormError(form(empty))).toBe(
      'Field "Shop Name" is a select and needs at least one option.',
    );
  });

  it('rejects blank and duplicate options, which become the persisted answer values', () => {
    const blank = field({ type: 'select', options: ['Small', '  '] });
    const dupe = field({ type: 'multi_select', options: ['Small', 'Small'] });

    expect(applicationFormError(form(blank))).toBe('Field "Shop Name" has a blank option.');
    expect(applicationFormError(form(dupe))).toBe(
      'Field "Shop Name" repeats the option "Small". Options must be unique.',
    );
  });

  it('still catches a real error sitting beside an untouched field', () => {
    const untouched = field({ key: '', label: '', order: 1 });
    const broken = field({ key: 'shop name' });

    expect(applicationFormError(form(broken, untouched))).toContain('is invalid');
  });
});
