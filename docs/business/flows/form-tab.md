---
layer: business
kind: flow
describes:
  - front-end/src/components/market/MarketFormTab.vue
verified: 2026-11-11
sources:
  - brain-dump/2026-10-19#5
  - brain-dump/2026-10-19#6
  - brain-dump/2026-10-19#7
  - E01/F06
  - E19/F03
  - E31/F04/S01
  - E33/F01
  - E33/F01/S01
  - E33/F01/S03
  - E33/F03/S01
  - bug/17
  - bug/29
  - bug/45
  - E32/F02/S01
  - E33/F01/S02
  - T15
  - E38/F02/S02
  - E38/F06/S01
  - E46/F01/S02
  - T206
  - T213
  - T223
  - T274
  - T271
---

# Building the application form

**Who:** the market's Editor, Admin or owner; the questions while the market is a draft and nobody has applied, the review setup longer.
**Where they start:** the Application Form tab, called "Questions" on a market whose vendors apply on the organizer's own Google Form ([`MarketFormTab.vue`](../../../front-end/src/components/market/MarketFormTab.vue)).
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md), [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md) and [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

The tab is a sequence of steps, each with the page's whole width, under a step header ("Application form setup", or "Questions setup" on the Google Form path) with "Back" and "Next" below each step:

1. **Essential questions** (F1), read only but for "Ask this".
2. **Your questions** (F2).
3. **Preview**, only on a market whose vendors apply on its page: the form at the applicant's own width, as they will see it, inside the tab.
4. **Review setup** (F3): what a reviewer reads first, and the automatic rejections.

The step header is a named navigation of buttons, the current one marked as the current step, so any step is one click away at any time; Back and Next are the obvious path, not the only one, and the step they open starts at the top of the page.
Moving between steps never loses an unsaved edit; only "Save Form" writes the questions, and it sits on Your questions and on Preview, while how the last save went shows on every step, since "Ask this" saves the moment it is ticked.
A locked form opens on Review setup, the step still the organizer's to change; the earlier steps stay one click away, read only under the lock's reason, and Review setup shows no lock.
A person who may change nothing finds every step read only, Review setup included, and reads why once, above the page; a step's banner says only the form's own lock (T15).
The step is in the address, `form?step=review` for Review setup, so a link, a bookmark or a refresh opens the step it names ([every market page has an address](../../implementation/conventions/every-market-page-has-an-address.md), T206).
Choosing a step from the header, Back or Next replaces the address rather than adding to the browser's history, so Back leaves the tab; a link naming another step while the tab is open moves there.
With no step named, or one the path lacks, the step is chosen once, as the tab opens: a lock that lands while the organizer is on a step does not move them off it.
The preview is a step inside the tab rather than the public page in a new browser tab, because a draft market has no public page to open.
On the Google Form path the essential questions are the answers each import reads from a column, nothing describes what an applicant would see, and the field editor offers no help text for applicants; the mapping of columns to questions stays in [the import](import.md), where the file is.

**Task:** "Add a required question asking what category of product each vendor sells: Food, Crafts or Art."

## F1. The essential questions

**Status:** Works (re-walked live on 2026-10-03; the step and the request read from the code as of E33/F01 and E31/F04/S01).

1. The "Essential questions" step ("Always included") lists the questions every form asks, derived from the plan and not removable: Email (from sign-in), Full name (the official one), Preferred name (optional; what they like to be called), Available dates, Number of dates you want, Tier preference (per date, with "Not available"), Table choice ("A whole table to myself", "Half a table, shared", "Either is fine"), Table-share partner (optional), Section preference (a ranking, with an "Ask this" checkbox; needs 2 or more sections), and "Anything else you need from us?" (optional free text, with "Ask this") (bug 17).
2. On a market whose vendors apply on its page, the Preview step asks them as an applicant will.
3. A question with nothing to offer is hidden from applicants and says why ("No market dates yet - this question is hidden from applicants until you add dates under Market Setup.").
4. Untick "Ask this" under Section preference to stop asking it; every applicant is then treated equally on sections.
   It saves at once, stays off through later form edits, and the applicant form then asks no ranking (bugs 29 and 45).
   It saves only that choice, with the questions as last saved: a question still being written stays unsaved and unsent, and is saved only by "Save Form", through its checks (T271).
   "Ask this" under "Anything else you need from us?" stops asking for a vendor's request the same way.

What the questions offer follows the plan until the first applicant answers, and is frozen from then on ([essential fields](../../implementation/modules/essential-fields.md)).
Covered by:

- `ask-this-stays-off.spec.ts`
- `essential-fields.spec.ts`
- `section-preference.spec.ts`
- `vendor-notes.spec.ts`

## F2. Custom questions

**Status:** Works (walked live).

1. On "Your questions", "Add field"; set Label (the Key is derived), Type (Text, Number, Select, Multi-Select, Checkbox, Date, Email), Required, Options for Select and Multi-Select ("Add option"), Help text.
2. Drag to reorder; "Remove" deletes.
3. "Save Form"; expect "Saved".

When someone else saved the form since this tab read it, another person or the same organizer in another tab, "Save Form" stores nothing and says [the market write's one sentence](../../implementation/modules/market-write.md#what-it-answers) where "Saved" would show, and the tab shows the questions as they were saved, so neither save replaces the other's questions ([the form's revision](../../implementation/modules/market-write.md#the-forms-revision)).
"Ask this" is refused the same way.
Covered by:

- `aFormSaveThatMetAChangedMarket.test.ts`
- `application-form.spec.ts`

"Add Discord username", beside "Add field" ([`FormBuilder.vue`](../../../front-end/src/components/application/FormBuilder.vue)), adds an optional Text question "Discord username" in one click, for a market that gives its vendors a role on Discord; the Discord card picks it up as the question that holds each vendor's username when the market connects ([the Discord connection](../../implementation/modules/discord.md#the-discord-card)).
It is not offered once the form has a Text question whose label names Discord.
Covered by:

- `formBuilder.test.ts`
- `the-tools-tab.spec.ts`

A question with more than 20 options shows its first 20 and "Show all 230 options", which unfolds the rest in place and becomes "Show fewer", so one question does not fill the step; it folds on a locked form too.
"Add option" on a folded question unfolds it and brings the new row into view; removing an option leaves the fold as it is.
A fold stays with its question when another question is removed or dragged past it.
When "Save Form" is refused for a blank option behind a question's fold, that question unfolds, so the blank row shows; a fold the organizer makes after that stays.
A fold changes what is drawn and nothing the question holds, so "Save Form" and "Use the answers in your file" reach the options behind it.
Covered by:

- `formBuilder.test.ts`
- `the-questions-come-from-the-file.spec.ts`

"Save Form" is disabled and says why while a field is invalid ('Field "Product category" is a select and needs at least one option.'); keys may not start with `essential_`, may not be one the import reads as something else (`applicant_email`, `submitted_at`, `sheet_note`), and must be unique.
A form with no questions of its own says "No questions of your own yet. Add field adds one."
Covered by:

- `application-form.spec.ts`

On a market started from its Google Form's responses, the questions also draw on the file it was started from, which the start kept the answers of, as far as they name nobody ([the CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md)); the start itself is one-shot, and this is where what it got wrong is fixed (E38/F02):

4. Change a question the start made to Select and its options are its column's answers; to Multi-Select, the options inside them ("Filled from the answers in your file.").
   Options the organizer edited stay through any change of type, and "Use the answers in your file" puts the file's back on purpose.
5. "Add from your file" lists the columns the start left out, such as a team's own "Status", and any question since removed; choosing one adds it with its label, type and options, and its key held, so the first import restores its column too.
   It is a select while the file offered 12 such columns or fewer, counting those already questions, and past that a field that finds a column by typing and stands empty for the next, with the focus still in it.
   A Select or Multi-Select the file gives no options to choose from becomes Text, since a choice needs at least one option.
6. An option on a Select or Multi-Select made from the file is a field with a list under it: every answer the file gave for that type's reading that is no other option on the question, most chosen first, with no counts ([ADR 0023](../../adr/0023-every-answer-for-an-option-to-offer.md)).
   A click or an arrow key opens it, not Tab; with nothing typed it shows all of them, and typing narrows it.
   Enter or a click takes a row and Escape closes the list.
   Whatever is typed is the option, less the spaces around it, so words in no list are kept when the field is left and Save never reports a blank option over them.
   Words that name an answer in its list in other capitals become that answer on leaving, so "felted tote bags" reads "Felted tote bags"; words in other capitals under another option's answer are in no list, since that option holds it, and stay as typed.
   An option keeps its own answer in its own list, and an answer comes back to the others' lists when the option holding it is removed or changed.
   The list follows a change of type, and opens in the page's flow, moving the rows below it down.
   A market started before this kept no answers, so its options offer only the common ones it kept; "Use the answers in your file", a type change and "Add from your file" (steps 4 and 5) fill only the common ones on every market.

A question that did not come from the file behaves as above, its options plain inputs, and a market not started from one offers none of this; nor does a locked form, whose options stay read only.
Covered by:

- `exampleColumns.test.ts`
- `formBuilder.test.ts`
- `the-questions-come-from-the-file.spec.ts`

## F3. What a reviewer reads first

**Status:** Works (walked live; the Review setup step and the automatic rejections read from the code as of E33/F01 and E33/F03/S01, and `automatic-rejections.spec.ts`).
On Review setup, under "What a reviewer reads first", tick the questions that should lead each review card; it saves itself and stays editable in every phase but Archived.
In a draft that has not decided, the section says "Not decided yet. Opening applications waits on this." ("Your first import waits on this." on a Google Form market) and offers "Nothing leads the card", one click; chosen, it reads back "Nothing leads the card: a reviewer reads every answer, in the form's order.", with the questions still below it, and ticking one replaces it ([review waits on the review setup](../rules/review-waits-on-the-review-setup.md)).
Someone who may not change the form reads the notice and the read-back, with no button; a market past draft shows no notice.
A mark counts as the form is saved, as the move into Review judges it: a mark on a question not yet saved leaves the notice up until Save Form.
Under "Automatic rejections", "Add a rule on" a choice question and tick the answers that reject, or past 12 answers find them by typing and see them as chips: "An application that gives one of these answers arrives in review already rejected, with the reason. An Admin or the owner can overturn it, and the applicant never sees the reason.", naming whoever the market's row "Change a verdict, or overturn an automatic rejection" lets overturn it.
In a draft that has not decided, the section says "Not decided yet. Opening applications waits on this." (or "Your first import waits on this.") and offers "No automatic rejections", one click, while no rule rejects an answer; chosen, it reads back "No automatic rejections: every application arrives undecided.", with "Add a rule on" still below it, and a rule replaces it, though a rule rejects nobody, and so decides nothing, until an answer is ticked.
The rules stay editable while the review is open; from Assignment on they are shown fixed, saying why in the review's words ([automatic rejections](../rules/automatic-rejections.md)): in Assignment, "The automatic rejections are closed while tables are allocated. To change a rule, choose Back to review under More… on the phase rail; tables are then allocated again."
Once the rules are fixed, the section shows no notice, no "No automatic rejections" button and no read-back.
Covered by:

- `automatic-rejections.spec.ts`
- `review-highlights.spec.ts`

## F4. The form lock

**Status:** Works (walked live; the words read from the code as of E31/F03/S02 and E33/F01/S03).
The questions are editable only while the market is a draft and nobody has applied ([the form locks at the first application](../rules/the-form-locks-at-the-first-application.md)).
Once locked, the essential questions and "Your questions" are read only under the reason:

- past Draft, on a market whose vendors apply on its page: "The application form is fixed: it cannot change once applications have opened, because applicants answer it.";
- past Draft, on the Google Form path: "The questions are fixed: they cannot change once its responses have been imported, because your imports are mapped onto them.";
- in Draft with an application: "Application form is locked. N applications have already been submitted for this market. The form cannot be modified once applicants have submitted."

Covered by:

- `application-form.spec.ts` ("an existing application locks the form in the builder and on every route")
- `screens-name-things.spec.ts`
- `what-to-show-and-when.spec.ts`

## F5. Reopen the market to fix the form

**Status:** Works (walked live).
From Applications, More…, "Reopen for editing" returns the market to Draft and lands on Market Setup, so the form can be edited; then leave Draft again.
A Google Form market is a draft until its first import, so its form is edited in place; once anything is imported there is no way back.
Refused once any application exists: "N applications are already in, so this market cannot return to draft. The questions are fixed once anyone has applied or been imported."
The first import offers the same fix without leaving the page ([H2e](import.md#h2e-add-a-question-for-a-column-with-nowhere-to-go), [H2f](import.md#h2f-stop-asking-a-preference-the-form-never-asked)), through [the form amendment](../../implementation/modules/form-amendment.md).
Covered by:

- `every-move-lands.spec.ts` ("a move back lands on its phase's page too")
- `what-to-show-and-when.spec.ts` ("a move the server would refuse says why in the menu")

## F6. Table type preference

**Status:** Stubbed.
The question exists but is hidden while every table is one type: "Every table is the same type for now, so no vendor ranks them. This question appears once a floorplan gives your market more than one table type."
Assignment uses one type in this release, so even a floorplan with several types does not turn it on in practice.

## Leaving with questions not yet saved

**Status:** Works (T271; `unsaved-questions-ask-first.spec.ts`).
The questions are unsaved while they differ from the questions as last saved; opening a step without an edit is not, nor is a form just saved, nor an "Ask this" choice, which saves itself.
With questions unsaved, a tab of the market bar, a link or Back opens "Leave without saving?": "Your changes to the form's questions are not saved. Leaving drops them.", with "Stay" and "Leave".
Stay, Escape, the close and a click beside the dialog keep the organizer on the form with every question as it was; Leave drops them and goes where they asked.
Moving between the tab's steps never asks, since the steps are one working copy, and a reload or closing the tab is asked by the browser in its own words.
Sign out never stops on it.
Every screen that holds unsaved work asks the same way ([unsaved work asks before it is dropped](../../implementation/conventions/unsaved-work-asks-before-it-is-dropped.md)).

A phase move refuses while the questions are unsaved, "Open applications" among them, and the [phase rail](../../implementation/modules/phase-rail.md) says "The market did not move: the form has changes that are not saved. Save Form first." as the move is pressed, before "Open applications" asks for the reviewers and before any of the plan's pending edits are sent ([the plan's autosave](../../implementation/modules/plan-autosave.md)).
It used to open the form as last saved, so applicants got a form without its last questions.
Covered by:

- `marketSetupForm.test.ts`
- `theFormTabInSteps.test.ts`
- `unsaved-questions-ask-first.spec.ts`

## The rules it obeys

- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md).
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): the form builder is not gated by it, and the preview is the online path's.
- [What each role may do](../rules/what-each-role-may-do.md): the form, the highlights and the automatic rejections are an Editor's.
- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md) and [automatic rejections](../rules/automatic-rejections.md): what a rule may name, what it judges, and that it closes with the review.
- [Vendor notes](../rules/vendor-notes.md): the request question, asked unless switched off.
- [Review waits on the review setup](../rules/review-waits-on-the-review-setup.md): a draft decides what a reviewer reads first and the automatic rejections before it enters Review.

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
