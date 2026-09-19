# 03: What does the importer do when the form never asked something the plan requires?

Type: grilling
Status: open
Blocked by: -

## Question

Import an ordinary form export into a market whose plan has two or more sections and the wizard stops dead at step 2 of 4.

Six of seven required questions map cleanly.
**Section preference** has no column to map, because the organizer's form never asked about sections - so `Preview import` is hard-disabled (`button.disabled === true`) and the import cannot proceed.

The advisory beside it is the best-written explanation in the product:

> "Your form never asked Section preference. It is a preference, not a constraint, so this market can stop asking it and treat every applicant equally. **Reopen the market for editing, turn it off in the form builder**, then open applications and import again."

I followed it.
The essential-questions panel is badged **"Always included"**, reads *"the table assignment reads them directly, so they cannot be removed"*, and contains **zero interactive elements** - verified by querying it for `button, input, select, textarea, a, [role=switch], [role=button], [contenteditable]`, which returns `[]`.

The advisory and the panel contradict each other, and the step the advisory names cannot be taken.

The real rule is `asks_ranking()` (`back-end/essential_fields.py:198`): a section ranking is asked whenever the plan offers **>= 2 sections**.
So the only way to stop asking it is to cut the plan below two sections - destroying the market's floor plan, not toggling a form question.

### What to decide

**What the product does when the offering makes a question required and the organizer's form never asked it.**

The advisory's own argument is the strongest clue: *"It is a preference, not a constraint"*.
If that is true, an unmapped ranking has an obvious meaning - no preference, rank nothing, treat every applicant equally - and the import could simply proceed.

Candidate answers:

- **Let an unmapped preference import as "no preference."** Takes the advisory's own reasoning to its conclusion and deletes the dead end. Needs care: it must not silently swallow an unmapped *constraint* like tier, where an absent answer is not a neutral answer.
- **Build the toggle the advisory promises.** Means deciding what "always included" means, since the panel currently says these questions cannot be removed. Also reopens whether the offering, not the organizer, should decide what is asked.
- **Rewrite the advisory to name the real remedy.** Cheapest and least satisfying: the real remedy is "delete a section", which no organizer will do to import a spreadsheet.

The distinction the answer probably turns on: **which essential questions are preferences and which are constraints.**
Section ranking and table-type ranking are preferences; tier is a filter that sets the price; available dates is a capability.
`asks_ranking()` already treats rankings as a class - fewer than two options is not a question - so the category may already exist in the code and just not reach the importer.

### Notes

This is a hard stop in the middle of a task, reached by the most ordinary path there is: a market with a normal floor plan and a Google Forms export.
Whatever the answer, the advisory's tone and precision are the model - it explains what the product cannot know and why. Keep that and fix where it points.

Findings: F6 in `.lavish/qc-2026-09-20.html`.
