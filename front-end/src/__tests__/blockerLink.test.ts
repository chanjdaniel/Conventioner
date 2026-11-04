/**
 * Where a blocker's fix is done, for the person reading it: a link only to work the market's table
 * lets them take (T142), since a link to work that is not theirs sends them to a page that refuses
 * it. One rule for every list of blockers: the rail's panel, the import's refusal and the landing.
 */
import { describe, expect, it } from 'vitest';
import type { PreconditionResult } from '@/assets/types/datatypes';
import { blockerLink } from '@/utils/blockerLink';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

const NO_LOCATION: PreconditionResult = {
  id: 'setup_has_a_location',
  passed: false,
  message: 'This market has no location. Add one on Market Setup.',
  resolutionLink: 'setup',
  resolutionLabel: 'Add a location',
  resolutionAction: MarketAction.ChangeSetup,
};

const market = (actionRefusals = answersRefusing()) => ({ id: 'm1', actionRefusals });

describe('blockerLink', () => {
  it("is the market's page the blocker names, for someone who may take its action", () => {
    expect(blockerLink(market(), NO_LOCATION)).toBe('/markets/m1/setup');
  });

  it('keeps a query the server spells on the page', () => {
    expect(blockerLink(market(), { ...NO_LOCATION, resolutionLink: 'setup?panel=dates' })).toBe(
      '/markets/m1/setup?panel=dates',
    );
  });

  it('is nothing for someone the table does not let take it', () => {
    expect(blockerLink(market(VIEWER_ANSWERS), NO_LOCATION)).toBeNull();
    expect(blockerLink(market(answersRefusing(MarketAction.ChangeSetup)), NO_LOCATION)).toBeNull();
  });

  it('is nothing where the blocker names no page, or no action, as from an older server', () => {
    expect(blockerLink(market(), { ...NO_LOCATION, resolutionLink: null })).toBeNull();
    expect(blockerLink(market(), { ...NO_LOCATION, resolutionLink: undefined })).toBeNull();
    expect(blockerLink(market(), { ...NO_LOCATION, resolutionAction: undefined })).toBeNull();
  });
});
