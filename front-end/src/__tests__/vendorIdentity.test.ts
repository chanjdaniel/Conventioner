/**
 * Every surface that names a vendor reads this, so the rule is pinned here once rather than
 * re-asserted on each of them: name primary, email secondary, never name instead of email, and a
 * vendor with no name renders as the product did before names existed.
 */
import { describe, expect, it } from 'vitest';
import { vendorHeadline, vendorMatches, vendorName } from '@/utils/vendorIdentity';

const NAMES = {
  'nadia@ember.test': 'Nadia Okonkwo',
  'theo@thistle.test': 'Theo Marchetti',
  'sam.a@shared.test': 'Sam Lee',
  'sam.b@shared.test': 'Sam Lee',
};

describe('vendorName', () => {
  it('is the name the application stored', () => {
    expect(vendorName('nadia@ember.test', NAMES)).toBe('Nadia Okonkwo');
  });

  it('matches however the address was capitalized, because every writer lowercases', () => {
    expect(vendorName('Nadia@Ember.Test', NAMES)).toBe('Nadia Okonkwo');
    expect(vendorName('  nadia@ember.test  ', NAMES)).toBe('Nadia Okonkwo');
  });

  it('is empty for a vendor whose application stored none', () => {
    expect(vendorName('legacy@ember.test', NAMES)).toBe('');
    expect(vendorName(null, NAMES)).toBe('');
  });
});

describe('vendorHeadline', () => {
  it('leads with the name when there is one', () => {
    expect(vendorHeadline('nadia@ember.test', NAMES)).toBe('Nadia Okonkwo');
  });

  it('falls back to the address, which is how the product read before names existed', () => {
    expect(vendorHeadline('legacy@ember.test', NAMES)).toBe('legacy@ember.test');
  });

  it('never decorates a nameless vendor with a placeholder', () => {
    expect(vendorHeadline('legacy@ember.test', {})).toBe('legacy@ember.test');
  });
});

describe('vendorMatches', () => {
  it('matches on the name', () => {
    expect(vendorMatches('okonkwo', 'nadia@ember.test', NAMES)).toBe(true);
  });

  it('matches on the address too, which is what the box used to do alone', () => {
    expect(vendorMatches('ember', 'nadia@ember.test', NAMES)).toBe(true);
  });

  it('still finds a vendor who has no name, by their address', () => {
    expect(vendorMatches('legacy', 'legacy@ember.test', NAMES)).toBe(true);
  });

  it('says no when neither matches', () => {
    expect(vendorMatches('marchetti', 'nadia@ember.test', NAMES)).toBe(false);
  });

  it('is case-insensitive on both', () => {
    expect(vendorMatches('NADIA', 'nadia@ember.test', NAMES)).toBe(true);
    expect(vendorMatches('Okonkwo', 'nadia@ember.test', NAMES)).toBe(true);
  });

  it('matches everyone on an empty query', () => {
    expect(vendorMatches('   ', 'anyone@ember.test', NAMES)).toBe(true);
  });

  it('keeps two vendors who share a name apart by their addresses', () => {
    expect(vendorMatches('sam.a', 'sam.a@shared.test', NAMES)).toBe(true);
    expect(vendorMatches('sam.a', 'sam.b@shared.test', NAMES)).toBe(false);
  });
});
