# 01: What is on each page?

Type: grilling
Status: resolved
Blocked by: -

## Question

The Assignment tab splits into **Rules** and **Result**.
What belongs on each, and where does changing the assignment happen?

The easy half: Assignment Priority, Assignment Options and Assign are Rules; the Summary, the per date / section / tier / table choice counts and the unassigned lists are Result.
The questions with weight:

- **Changing a placement.** Move, free and swap live on the Tables screen today, and a pin is a placement row flagged `hand_placed` that the next run seats first (AGENTS.md, **Placements, Pins and the Trail**).
  A pin is therefore an edit to the result that is also an input to the next run.
  Does changing a placement belong on Result, on Tables, or on Result by way of Tables?
- **Assign, and running it again.** Assign on Rules is natural the first time.
  Once an assignment exists, running again replaces every placement that is not a pin.
  Is re-running a Rules action, a Result action, or both, and what does the organizer see before they destroy hand work?
- **The placement history and the CSV.** Both describe the stored assignment, so Result by the glossary; is either wanted anywhere else (the history also records hand placements made on Tables)?
- **The quick links to Vendors, Tables and Attendance.** They exist because those screens are not tabs; do they survive the answer to [02](02-how-every-market-screen-is-reached.md), or does this ticket leave them for 02 to remove?
- **A market with no assignment yet.** What Result says before the first run, and what Rules says in a phase where Assign is refused (the refusal lives in `assign_phase_refusal`).

Start from the live tab ([screenshot](../assignment-tab-1920.png)) and the Tables screen with a seated market.

## Answer

Grilled and decided 2026-09-26.

**The tab's two pages are Assignment and Result.**
The first was provisionally "Rules"; organizers call setting up and running it "the assignment", so the page carries their word.
The glossary keeps the distinction underneath: **Assignment rules** are what the page sets, and **Assignment** is still what the solver produces (`CONTEXT.md`).

Facts that shaped the answer, read from the code:

- **Every hand placement is already a pin.** The placement write stores `hand_placed`, and a run seats pins first, so running again never destroys hand work; it re-places only what the solver placed.
- **Running is allowed only in `assignment`** (`assign_phase_refusal`), and past it the server already sends the organizer to Tables to change one placement.
- **Nothing asks before a re-run today**, and a stored assignment records only when it ran.

### The Result page is the assignment, read and changed in one place

The organizer's "result" is *who sits where*, which is the Tables grid; the statistics summarise it.
So the Result page carries, top to bottom: a summary strip, the tables grid with its per-seat editing (fill, free, swap), the unassigned vendors, the placement history, and the CSV.
**The Tables screen moves into Result**; its old address redirects there.
Vendors and Attendance are [02](02-how-every-market-screen-is-reached.md)'s to place, and so are the quick links, which exist only because those screens are not tabs.

### The Assignment page sets the rules and runs them

- Assignment Priority, Assignment Options, and the run button.
- **A run lands on Result.**
- Once an assignment exists the button reads **Run again**, with one line under it saying what it keeps: "Keeps your 4 hand placements; places everyone else again." No confirmation dialog: it recomputes only the solver's placements, and nothing has been sent to vendors in this phase.
- **Editable up to and including `assignment`, read-only after**, with a line saying why: past `assignment` nothing can run, so an edit would change nothing.
  **The server refuses it too:** the plan write refuses a change to the assignment rules after `assignment`, as it refuses an intake-mode change after draft. A hidden control is not the rule.

### Before the first run

Result says there is no assignment yet and links to the Assignment page; where the phase refuses a run, it says why in `assign_phase_refusal`'s words.

### Buildable work

- [E22/F02 The assignment rules close with the assignment](../../../backlog/E22-the-assignment-tab/F02-the-rules-close-with-the-assignment/feature.md): the server refusal and the read-only page.
- The page split itself is written once [02](02-how-every-market-screen-is-reached.md) decides the addresses and the navigation.
