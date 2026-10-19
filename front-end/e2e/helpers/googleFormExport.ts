/**
 * A Google Form's responses as its export writes them, on the dates, tiers and sections
 * `planSetupObject` (`seedApplicantMarket.ts`) plans, for the specs that walk an import through
 * the UI. Each row is one applicant; a spec builds the export it needs from them.
 */
export const EXPORT_HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Which days can you attend?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
  'Business name',
  'What do you sell?',
];

export const RESPONSES = {
  nadia:
    '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,2099-08-01,Gold,full,"Garden, Main Hall",Ember Ceramics,Pottery',
  theo: '2026/05/02 11:40:22,theo@thistle.test,Theo Marchetti,2099-08-08,Silver,half,"Main Hall, Garden",Thorn & Thistle,Dried flowers',
  ines: '2026/05/04 16:05:51,ines@loom.test,Ines Albrecht,2099-08-01,Gold,full,"Main Hall, Garden",Loom & Weft,Woven goods',
};

/** An export holding these responses, header first. */
export function exportOf(...rows: string[]): string {
  return [EXPORT_HEADERS.join(','), ...rows].join('\n');
}

/** Every question the organizer maps by hand; Timestamp and Email Address are recognised. */
export const EXPORT_MAPPING: Record<string, string> = {
  'Full Legal Name': 'essential_full_name',
  'Which days can you attend?': 'essential_available_dates',
  'Which tiers will you accept?': 'essential_tier_preference',
  'Full or half table?': 'essential_table_choice',
  'Rank the sections': 'essential_section_ranking',
  'Business name': 'business_name',
  'What do you sell?': 'product_type',
};
