# 02: Is the local environment ready, and local-only?

Type: task
Status: resolved
Blocked by: -

## Question

Can the run start on this machine today, and is it certain that nothing from the file leaves it: no email to a real applicant, no call to hosted TypeSafe, nothing committed?

## Answer

Resolved AFK on 2026-10-09.
**Ready, after one fix.**

### Found and fixed: the stack was sending real email

The primary stack (`conventioner`, front end on 5173, back end on 5000) had been brought up without `DISABLE_EMAIL=true`, and the root `.env` that Compose interpolates holds a working Resend key.
The back end therefore had a sendable key and email on.
On this run that would have mailed a sign-in code to any applicant address typed into the vendor sign-in.

Fixed by recreating the back end with the flag: `DISABLE_EMAIL=true docker compose up -d backend`.
Verified inside the container afterwards: `_email_disabled()` is true.

**This does not persist.** Any later `docker compose up` from the primary checkout without the flag turns email back on.
Re-run the check below at the start of the run session; or add `DISABLE_EMAIL=true` to the root `.env`, which this map has not done because it changes every future stack.

### Checked

| Check | Result |
| --- | --- |
| Stack runs current code | Back end and front end bind-mount the primary checkout, on `dev` at `ea29bb67`, clean |
| Back-end dependencies | The container's Flask, flask-cors and pymongo match `requirements.txt` after `#90` |
| Database | Clean seed state: users `e2e@example.com` and `e2e-noorg@example.com`, organization "Seed Test Org", two seed markets, zero applications; all three boot migration markers recorded |
| Email | Off, after the fix above |
| Hosted TypeSafe | Off. The back-end `.env` holds a key, but Compose passes `TYPESAFE_API_KEY` as an empty string and the environment wins over the file, so `configured_key()` is empty and the proposal runs on its rules alone |
| Other outbound keys | No OpenAI or Gemini key; the floorplan vision endpoint is not on the run's path anyway |
| Captcha | `DISABLE_CAPTCHA=true`; registration still out of scope |
| Playwright MCP | `@playwright/mcp` over stdio, local Chromium. Opened `http://localhost:5173` at 1440 by 900 and signed in as `e2e@example.com` to the dashboard |
| Where artifacts land | `.playwright-mcp/` (snapshots, console logs, screenshots, any copy of the file) is git-ignored; so is `.scratch/examples/` |
| Check-in before the market | `record_attendance` checks only that the vendor holds a placement on that date, not that the date is today, so the market days can be walked on 2026-10-09 |

### Seen on the way, to note in the run report

- Opening `/` signed out logs two console errors (401 on `/api/markets` and `/api/check-session`) before the redirect to sign-in.
- The sign-in password field has no `autocomplete="current-password"`; Chromium flags it.

### Pre-flight for the run session

```bash
docker exec -w /app conventioner-backend-1 python -c "
from utils.env_file import load_env_file; load_env_file()
from utils import email as e; import typesafe_client as t
assert e._email_disabled(), 'EMAIL IS ON - stop'
assert not t.configured_key(), 'TYPESAFE IS ON - stop'
print('local-only: ok')"
```
