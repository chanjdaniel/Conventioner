---
id: E27/F01/S03
title: A request that pairs nobody is shown
type: story
status: todo
blocked_by: [E27/F01/S01]
pr: []
---

## What to build

Today a table-share request that can pair nobody silently becomes an ordinary half-table request, and the vendor may be seated beside a stranger without anyone knowing.

Show it, never block on it, in two places:

- **The review card**, beside the table-share answer.
- **The vendor's detail** on the Vendors page.

The notice says, in words an organizer can act on (by Discord or email, outside the product), why the request cannot pair:

- **No address in the answer:** "No email address in this answer", with the applicant's own wording shown.
- **No applicant with that address:** "Nobody in this market applied as someone@example.com".
- **The partner wants a full table only:** "someone@example.com asked for a full table".

This is derived when it is read, never stored, because the partner may apply or be imported later.
It is served with the applications the screens already load, not fetched per screen.
It does not stop an import, a review verdict or an assignment run.

## Acceptance criteria

- [ ] Each of the three cases shows its notice on the review card and in the vendor's detail.
- [ ] A request that does pair shows no notice.
- [ ] Importing the partner after the requester clears the "nobody applied" notice with no other action.
- [ ] Import, review and assignment all proceed with the notices present.
- [ ] The notice uses the shared primitives and tokens, and is named for assistive technology.
- [ ] Playwright: a seeded market with one request of each kind shows each notice and no notice on a valid pair.
