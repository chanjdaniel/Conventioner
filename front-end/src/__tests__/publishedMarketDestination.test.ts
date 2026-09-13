import { describe, it, expect } from 'vitest';

import { publishedMarketDestination } from '@/utils/marketSlug';
import { IntakeMode } from '@/assets/types/datatypes';

describe('publishedMarketDestination', () => {
  it('sends a form market to its public market home', () => {
    expect(publishedMarketDestination('Spring Market', IntakeMode.Form)).toBe('/spring-market');
  });

  it('sends a CSV market to its check-in page', () => {
    // Its market home answers as a market that does not exist, so landing the organizer there
    // would tell them their own market cannot be found. Check-in is the page it does serve, and
    // the link they need to share on the day.
    expect(publishedMarketDestination('Spring Market', IntakeMode.Csv)).toBe(
      '/spring-market/check-in',
    );
  });

  it('treats a market that names no intake mode as CSV, as the server does', () => {
    expect(publishedMarketDestination('Spring Market', undefined)).toBe('/spring-market/check-in');
  });

  it('falls back to the organizer market page when the name yields no slug', () => {
    expect(publishedMarketDestination('!!!', IntakeMode.Form)).toBe('/market-setup');
    expect(publishedMarketDestination('', IntakeMode.Csv)).toBe('/market-setup');
  });
});
