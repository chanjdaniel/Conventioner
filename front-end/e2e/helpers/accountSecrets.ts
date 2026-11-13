import crypto from 'node:crypto';
import { mongoEval } from './mongo';

/**
 * An organizer account's sign-in secrets, planted as the mail would carry them.
 *
 * The back end keeps each of an account's sign-in secrets as one record under its `secrets`
 * field, hashed (`back-end/account_secrets.py`), so a spec cannot read a code or a link out of
 * MongoDB after asking for one, and the stack mails nothing. These write the record as a mailed secret leaves
 * it, for a secret the spec knows: call them AFTER asking for one through the UI or the API (or
 * standing in for that request), as `createApplicantLoginChallenge` does for a vendor's code.
 */

/** How long a code lasts, and how long after it expires the next may be asked for. */
const CODE_LIFE_MS = 5 * 60_000;
const CODE_WAIT_MS = 60 * 60_000;

function filterFor(email: string): string {
  return `{ email: ${JSON.stringify(email.toLowerCase())} }`;
}

/**
 * Plant `code` as the account's mailed sign-in code: live, kept salted and hashed, five minutes to
 * run, its wait running an hour past that. `tries` plants a code with that many of its five tries
 * already used.
 */
export function plantSignInCode(
  email: string,
  code: string,
  { tries = 0 }: { tries?: number } = {},
): void {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
  const expiresAt = Date.now() + CODE_LIFE_MS;
  mongoEval(
    `db.users.updateOne(${filterFor(email)}, { $set: { 'secrets.code': {` +
      ` hash: ${JSON.stringify(`${salt}:${digest}`)},` +
      ` expires_at: new Date(${expiresAt}),` +
      ` next_allowed_at: new Date(${expiresAt + CODE_WAIT_MS}),` +
      ` tries: NumberInt(${tries}), state: 'live' } } })`,
  );
}

/** How long a reset link lasts, and how long after it expires the next may be asked for. */
const LINKS = { reset: { lifeMs: 60 * 60_000, waitMs: 60 * 60_000 } } as const;

/** A link as the mail carries one: 24 random bytes, URL-safe, as `token_urlsafe(24)` makes it. */
export function newAccountLink(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Plant `token` as the account's mailed link of `kind`: live, kept as its SHA-256, its kind's life
 * to run, its wait running past that.
 */
export function plantAccountLink(email: string, kind: keyof typeof LINKS, token: string): void {
  const { lifeMs, waitMs } = LINKS[kind];
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + lifeMs;
  mongoEval(
    `db.users.updateOne(${filterFor(email)}, { $set: { 'secrets.${kind}': {` +
      ` hash: ${JSON.stringify(digest)},` +
      ` expires_at: new Date(${expiresAt}),` +
      ` next_allowed_at: new Date(${expiresAt + waitMs}),` +
      ` tries: NumberInt(0), state: 'live' } } })`,
  );
}

/** Forget the account's sign-in code, leaving no wait, as a spec leaves the shared account. */
export function forgetSignInCode(email: string): void {
  mongoEval(`db.users.updateOne(${filterFor(email)}, { $unset: { 'secrets.code': '' } })`);
}
