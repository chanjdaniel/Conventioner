import { execFileSync } from 'node:child_process'
import { backendContainer } from './containerNames'

/**
 * Markers printed by `back-end/create_test_user.py`. The script exits 0 whether it created the
 * user, found one already there, or failed to insert, so its exit code says nothing; its output
 * is the only signal that a login-ready user actually exists.
 */
const CREATED_MARKER = 'Successfully created test user'
const ALREADY_EXISTS_MARKER = 'already exists'

/**
 * Create a verified test user, idempotently.
 *
 * `/register-user` does NOT set `email_verified`, so a user created through it cannot log
 * in. `back-end/create_test_user.py` is the one place that creates a login-ready user, and
 * it is what `scripts/seed_fixture.sh` already runs for the fixture users; a spec that needs
 * its own users runs the same script rather than re-deriving the document shape. The script
 * is a no-op when the email already exists, so this is safe to call from every `beforeAll`.
 *
 * A seeding failure has to surface here, at the `beforeAll` that caused it, rather than much
 * later as an opaque login timeout, so the script's output is checked for one of the two
 * outcomes that leave a usable user behind.
 */
export function ensureVerifiedUser(email: string, password: string): void {
  const output = execFileSync(
    'docker',
    ['exec', backendContainer(), 'python', '/app/create_test_user.py', email, password],
    { encoding: 'utf-8', timeout: 30_000 },
  )

  if (!output.includes(CREATED_MARKER) && !output.includes(ALREADY_EXISTS_MARKER)) {
    throw new Error(
      `create_test_user.py did not confirm a verified user for ${email}.\n` + `Output:\n${output}`,
    )
  }
}
