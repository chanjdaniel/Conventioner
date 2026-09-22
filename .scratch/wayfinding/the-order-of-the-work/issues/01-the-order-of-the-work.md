# 01: What order does building a market actually happen in?

Type: grilling
Status: resolved
Blocked by: -

## Question

The market workspace presents four peer tabs - Application Form, Market Setup, Applications, Assignment Results - and six simultaneous plan cards.
Neither is an order, and the work has one.

Three dependencies are real and two of them run against the interface:

**The form cannot be built before the plan.**
`back-end/essential_fields.py` opens with the rule: *"The offering is never an independent list: it is the market plan itself. Dates come from `SetupObject.market_dates`, sections from `SetupObject.sections`, tiers from `SetupObject.tiers`."*
The essential questions have nothing to offer until the plan is decided.
The tab bar puts Application Form first, which inverts it.

**Assignment Priority and Assignment Options sit in the earliest stage and are usable only in the latest.**
A priority rule names a form field key or an `application.` attribute, so it cannot be filled in before the form exists, and it is most meaningful once applications are in hand.
Both cards live in Market Setup, the furthest possible point from where they belong.

**Table types are asked of applicants and answerable by nobody.**
`essential_table_type_ranking` is one of the nine essential questions, but table type is a property of an individual table, so only a floorplan can describe it - and the floorplan GUI is cut from MVP.
The stand-in is `STUB_TABLE_TYPE = "Standard"`: one type per market, the fewer-than-two rule suppresses the ranking, the question is never asked.
There is no screen on which an organizer decides their table types.

### What to decide

**The order of stages in getting a market ready, and which cards belong to which stage.**

The order stated during the walk, to be confirmed or amended:

1. **Market setup** - dates, tiers, locations, sections, and table types. Minus Assignment Priority and Assignment Options.
2. **Application form** - built from the values decided in step 1.
3. **Finalize** both, which is what opens applications.
4. **Applications** - receive and review them.
5. **Assignment** - a stage that does not exist today, holding Assignment Priority and Assignment Options.
6. **Assignment results.**

Sub-questions the answer must settle:

- **Is "Assignment" a new phase, a new tab, or a section of Assignment Results?**
  A phase means `VALID_TRANSITIONS`, `guards.py` and `_validate_registry()` - and `phaseSpine()` derives the rail from that table, so a new phase appears on the rail automatically.
  That may be exactly right, or far too heavy for what is really a grouping of two cards.
- **Where do table types get decided?**
  A Table Type plan card beside the others, which also removes the form's dependency on a floorplan MVP does not ship - or an explicit decision that the stub stands for MVP and the question is deferred.
  What must not persist is the current middle ground, where the dependency exists, the question exists, and the input does not.
- **Does the tab bar survive?**
  If the stages are ordered, four peer tabs is the wrong control for them.

### Notes

This ticket is the spine of the map.
Tickets 02 and 03 are blocked on it, and ticket 07 is blocked through 03.

It deliberately does not decide *presentation* - whether the draft state becomes a guided walk is ticket 02.
This ticket says what the steps are; that one says what they look like.

Findings: `Q5`, and the table-type paragraph inside it, in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**The phase spine is already correct, and the workspace will follow it. Nothing in `VALID_TRANSITIONS` or `guards.py` changes.**

The spine, computed from the transition table rather than assumed:

```
draft -> applications_open -> applications_closed -> review -> assignment -> market_days -> archived
```

The walk's proposed order was right and the phase machine already encodes it, including the `assignment` stage it thought was missing.
`assign_phase_refusal` in `back-end/api/placements.py` already enforces that Assign runs in that phase and nowhere else.
**What was wrong is the workspace, not the lifecycle**: four peer tabs laid over seven phases with no correspondence, so Assignment Priority, Assignment Options and a permanently-disabled Assign button all sit in Market Setup beside the dates.

### Four decisions

**1. The workspace shows the surface for the market's current phase.**
The tab bar stops being four peers and becomes navigation along the spine, so the rail and the workspace say the same thing instead of two different things.
Earlier stages stay reachable - the plan remains editable in later phases, and CLAUDE.md's rule that "shrinking the plan does not unassign anybody" depends on that staying true.

**2. `draft` carries two ordered stages inside it: the plan first, then the application form built from it.**
This is the one place the phase machine cannot express the order, because both belong to `draft` - and it is exactly where the dependency is real.
`essential_fields.py` is explicit that "the offering is never an independent list: it is the market plan itself", so the form has nothing to offer until the plan exists.
The answer is **not** to add a phase between them.
The answer is that the draft surface presents them in order and makes the dependency legible, which is [ticket 02](02-what-the-draft-workspace-looks-like.md)'s to design.

**3. Assignment Priority, Assignment Options and the Assign button move out of Market Setup onto the `assignment`-phase surface.**
They are not part of setting up a market.
A priority rule names a form field key, so it cannot be written before the form exists; and Assign is already refused outside that phase, so showing a disabled button in `draft` explains a rule instead of applying it.

**4. Table types: `STUB_TABLE_TYPE` stands for MVP, and that is now deliberate rather than a gap.**
No Table Type plan card.
Every market offers exactly one type, the fewer-than-two rule suppresses the ranking, and the question is never asked of anybody.
The key, its validation and its front-end mirror all stay in place - only a real offering is missing, and only a floorplan can supply one, because a table type is a property of an individual table.
The stub must be **documented as a decision** where an organizer or an agent would otherwise read it as an oversight; the walk found it looking like a hole, which is the cost of an undocumented stand-in.

### What this hands to other tickets

- **[02](02-what-the-draft-workspace-looks-like.md)** - how draft's two ordered stages are presented. That ticket now has a fixed brief: plan before form, dependency visible, both inside one phase.
- **[03](03-what-finalized-means.md)** - "finalized" is now specifically *the plan and the form are both done*, which is the gate on `draft -> applications_open`. That narrows the question rather than changing it.
- **[06](06-what-shape-is-the-import-flow.md)** - the import wizard is an `applications_open` surface, so its shape is a question about one stage of the spine, not a standalone screen.

### What it does not answer

`applications_open`, `applications_closed` and `review` are three phases about the same subject.
Whether they get three surfaces or one surface in three states is not settled here.
Graduated to the map's Not yet specified.
