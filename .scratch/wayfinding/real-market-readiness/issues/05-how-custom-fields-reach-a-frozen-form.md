# 05: How do the fields a reviewer needs reach a form that is already frozen?

Type: grilling
Status: open
Blocked by: 04

## Question

Report finding W1.

Three rules combine into a one-way door with no sign on it:

1. The application form is editable **only in `draft`** (`application_form_lock_reason`).
2. CSV import is allowed **only in `applications_open` / `applications_closed`**.
3. **No transition returns to `draft`** - `back-end/guards.py:174` lists every edge and nothing
   points back.

So an organizer must define every custom field they will ever want before clicking "Open
Applications", having never seen the import screen or their own columns. One click later the form is
frozen permanently, before a single applicant exists. The lock message names the phase as the reason,
not the applications, so it fires even on an empty market.

For the real file this means Business Name, what they are selling, the portfolio link, UBC
affiliation, club membership and Discord handle are unrecoverable. Which is why ticket 04's reviewer
has only an email address.

Decide the escape:

- **An `applications_open -> draft` edge, guarded on no application existing.** Restores the
  organizer's ability to go back exactly while going back is safe. Adds an edge to a state machine
  whose whole design is that every precondition lives in one file, so the cost is small and visible.
- **Let the import wizard create a custom field from an unmapped column**, in place. Puts the
  decision where the organizer is actually looking at their columns, and removes the need to
  anticipate anything. But it writes the form from a surface that is not `PUT /markets/<id>/application-form`,
  which `AGENTS.md` is emphatic is the form's only writer on an existing market - the thing that makes
  the D9 lock unbypassable.
- **Both**, if they answer different moments.

Take this after ticket 04, which decides what a reviewer actually needs to see; that set is the thing
this ticket has to get onto the form.

Whatever is decided must not weaken the D9 lock's actual purpose: once an applicant has submitted,
the form they answered can never move under them.
