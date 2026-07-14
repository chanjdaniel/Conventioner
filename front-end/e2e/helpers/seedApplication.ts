import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mongoContainer } from './containerNames';

/**
 * Insert an application document for a market, straight into Mongo.
 *
 * The D9 form lock engages as soon as one application exists for a market
 * (`api/applications.py` counts them by `market_id`). Applicants cannot yet submit
 * through the product - the applicant-facing submit endpoint lands in a later PR - so
 * the only way to reach the locked state is to write the document the way that endpoint
 * eventually will: snake_case, matching the `Application` model in `datatypes.py`.
 *
 * Runs `mongosh` inside the stack's Mongo container, which the e2e suite already assumes
 * is running (`auth.spec.ts` reads reset tokens the same way).
 */
export function seedApplication(marketId: string, applicantEmail = 'applicant@example.com'): string {
  const applicationId = randomUUID();
  const application = {
    id: applicationId,
    market_id: marketId,
    applicant_email: applicantEmail,
    form_data: { business_name: 'Sample Applicant' },
    status: 'open',
    application_type: 'main',
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    otp_attempts: 0,
  };

  execFileSync(
    'docker',
    [
      'exec',
      mongoContainer(),
      'mongosh',
      'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin',
      '--quiet',
      '--eval',
      `db.applications.insertOne(${JSON.stringify(application)})`,
    ],
    { encoding: 'utf-8' },
  );

  return applicationId;
}
