import { mongoEval } from './mongo';

/**
 * Remove a user document straight from Mongo.
 *
 * `POST /delete-user` is not usable for this. It requires an authenticated session and deletes only
 * the account that session belongs to (E07/F01/S01) - it used to take the caller's identity from the
 * `X-Owner-Email` header with no login at all, which is what let an anonymous request delete any
 * verified account. The tests that need this cleanup create *unverified* users through
 * `/register-user`, and an unverified user cannot log in, so there is no session to authenticate
 * with by construction.
 *
 * Deleting the document is therefore the honest way to undo a test fixture: it is maintenance on the
 * database, which is exactly what the old anonymous endpoint was pretending to be.
 *
 * Runs through `mongoEval` (`helpers/mongo.ts`), as `seedApplication.ts` and
 * `auth.spec.ts`'s reset-token read already do.
 */
export function deleteUser(email: string): void {
  mongoEval(`db.users.deleteOne(${JSON.stringify({ email })})`);
}
