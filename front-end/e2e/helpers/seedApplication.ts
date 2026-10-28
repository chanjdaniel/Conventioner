import { randomUUID } from 'node:crypto';
import { mongoEval } from './mongo';

/**
 * Insert an application document for a market, straight into Mongo.
 *
 * The D9 form lock engages as soon as one application exists for a market
 * (`api/applications.py` counts them by `market_id`). Applicants cannot yet submit
 * through the product - the applicant-facing submit endpoint lands in a later PR - so
 * the only way to reach the locked state is to write the document the way that endpoint
 * eventually will: snake_case, matching the `Application` model in `datatypes.py`.
 *
 * Runs through `mongoEval` (`helpers/mongo.ts`), which assumes the stack's Mongo container
 * is running (`auth.spec.ts` reads reset tokens the same way).
 */
/** "nadia@ember.test" -> "Nadia Ember", so a seeded vendor has a name and no two share one. */
function nameFromEmail(email: string): string {
  const [local, domain = ''] = email.split('@');
  const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const given = capitalize(local.replace(/[^a-zA-Z]/g, '') || 'Vendor');
  const family = capitalize(domain.split('.')[0]?.replace(/[^a-zA-Z]/g, '') || 'Applicant');
  return `${given} ${family}`;
}

export function seedApplication(
  marketId: string,
  applicantEmail = 'applicant@example.com',
  formData: Record<string, unknown> = { business_name: 'Sample Applicant' },
): string {
  const applicationId = randomUUID();
  const application = {
    id: applicationId,
    market_id: marketId,
    applicant_email: applicantEmail,
    form_data: formData,
    status: 'open',
    application_type: 'main',
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  mongoEval(`db.applications.insertOne(${JSON.stringify(application)})`);

  return applicationId;
}

/**
 * Insert an APPROVED application carrying the essential answers the solver reads.
 *
 * This is what the e2e seeds used to fabricate a CSV for. The solver read a `source_data`
 * collection, so every seed had to upload a spreadsheet whether or not the test was about
 * importing one; the comments in `seeds.ts` called that a Phase 5 dependency. The solver reads
 * applications now, so a vendor is seeded as what a vendor actually is.
 *
 * Answers are stored in the shapes `essential_fields.py` validates into: dates and tiers as
 * lists of the market plan's own names, the count as an integer, the table choice lower-cased.
 */
export function seedApprovedVendor(
  marketId: string,
  applicantEmail: string,
  answers: VendorAnswers,
): string {
  const application = approvedVendorApplication(marketId, applicantEmail, answers);
  mongoEval(`db.applications.insertOne(${JSON.stringify(application)})`);
  return application.id;
}

/** What an approved vendor answered: the essential questions, and any of the form's own. */
export interface VendorAnswers {
  dates: string[];
  tiers: string[];
  sections?: string[];
  maxDates?: number;
  tableChoice?: string;
  shareWith?: string;
  fullName?: string;
  extra?: Record<string, unknown>;
}

/**
 * The application `seedApprovedVendor` writes, built and not written, so a seed of many vendors
 * writes them with one `insertApplications` rather than a container round trip each.
 */
export function approvedVendorApplication(
  marketId: string,
  applicantEmail: string,
  answers: VendorAnswers,
) {
  return {
    id: randomUUID(),
    market_id: marketId,
    applicant_email: applicantEmail,
    form_data: {
      // Identity is asked of every market (E13/F01/S01). Derived from the address so two seeded
      // applicants never share a name, which is what the surfaces have to keep apart.
      essential_full_name: answers.fullName ?? nameFromEmail(applicantEmail),
      essential_available_dates: answers.dates,
      essential_max_dates: answers.maxDates ?? answers.dates.length,
      // Tier is answered PER DATE (E01/F05), because a tier is a hard filter that sets the
      // price. A flat `tiers` here means the same tiers on every date - the common case, and what
      // the old single-set answer meant.
      essential_tier_preference: Object.fromEntries(
        answers.dates.map((date) => [date, answers.tiers]),
      ),
      essential_table_choice: answers.tableChoice ?? 'full',
      essential_table_share_email: answers.shareWith ?? '',
      essential_section_ranking: answers.sections ?? [],
      essential_table_type_ranking: [],
      ...(answers.extra ?? {}),
    },
    status: 'reviewer_approved',
    application_type: 'main',
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Write many applications in one call: each `mongoEval` is a round trip into the container. */
export function insertApplications(applications: { id: string }[]): void {
  if (applications.length === 0) return;
  mongoEval(`db.applications.insertMany(${JSON.stringify(applications)})`);
}

/**
 * Set one answer on an applicant's stored application, as though they had written it.
 *
 * For a spec that needs a particular answer on an otherwise ordinary seeded vendor - a web address
 * the vendor drawer must link (E28/F04/S03), say - without a seed of its own.
 */
export function setApplicationAnswer(
  marketId: string,
  applicantEmail: string,
  key: string,
  value: unknown,
): void {
  const filter = { market_id: marketId, applicant_email: applicantEmail };
  const update = { $set: { [`form_data.${key}`]: value } };
  mongoEval(`db.applications.updateOne(${JSON.stringify(filter)}, ${JSON.stringify(update)})`);
}
