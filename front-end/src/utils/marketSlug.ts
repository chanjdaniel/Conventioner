import { IntakeMode } from '@/assets/types/datatypes';

/**
 * Single URL path segment from a market display name: lowercase kebab-case, URL-safe.
 */
export function marketNameToKebabSlug(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Where an organizer goes after publishing a market: the public page that market actually serves.
 *
 * A market's bare slug is part of the applicant surface, which serves form-intake markets only, so
 * sending a CSV market's organizer there hands them a page saying their own market cannot be
 * found. Check-in is the page a CSV market does serve, and the link its vendors need on the day.
 *
 * An absent intake mode is CSV, the same reading the server makes, so a market written before the
 * field existed is not sent somewhere it cannot answer.
 */
export function publishedMarketDestination(
  marketName: string,
  intakeMode: IntakeMode | undefined,
): string {
  const slug = marketNameToKebabSlug(marketName);
  if (!slug) {
    return '/market-setup';
  }
  return intakeMode === IntakeMode.Form ? `/${slug}` : `/${slug}/check-in`;
}
