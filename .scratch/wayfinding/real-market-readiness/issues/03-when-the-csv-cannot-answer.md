# 03: What happens when the CSV cannot answer a question the market asks?

Type: grilling
Status: open
Blocked by:

## Question

Report finding B3.

Section preference is required as soon as a market has two or more sections
(`asks_ranking`, `back-end/essential_fields.py:149`). Tier is a property of a section in the setup
model - a section row is `name, location, tier, count` - so a market offering Gold, Silver and
Bronze needs at least three sections, and therefore always asks for a section ranking.

The real form never mentions sections. Vendors do not know the room is divided. So the import
requires an answer that does not exist in the file, and the organizer cannot escape by simplifying
their plan: collapsing to one section collapses to one tier.

There is no way anywhere in the wizard to say "this question was not asked".

Decide what the escape is:

- **Declare a required essential question "not asked" at import**, supplying a default. Section
  ranking is explicitly a soft preference in the solver and never a filter, so a uniform default is
  harmless for this question. Whether it is harmless for the others is exactly what needs deciding:
  the same mechanism would be reachable for available dates, where a default is not harmless at all.
- **Derive it**, giving every applicant the same ranking without asking anyone. Simpler, but it puts
  a fabricated answer into `form_data` where an applicant's own answer lives, which the
  `IncompleteApplicationsError` design was built to prevent.
- **Decouple tier from section**, so a multi-tier market does not force multiple sections and the
  question is never asked. Attacks the cause rather than the symptom, and is much larger.

Whatever is decided has to hold the line `essential_fields.py` already draws: requiredness is defined
by what the market asked, and there is exactly one statement of that rule, read by both the applicant
validator and the solver's translation. A per-question override must not become a second place that
decides what is required, or the drift shows up as the solver rejecting answers the form accepted.
