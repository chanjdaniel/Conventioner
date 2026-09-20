# 06: Does a market remember where it has been?

Type: grilling
Status: open
Blocked by: 02

## Question

An archived market states something false about itself.

This market walked the whole lifecycle - draft through assignment to **market_days**, where its public check-in page served a real lookup - and was then archived.
The frozen rail says:

> "This market is archived. **It was assigned but never published, so no check-in page went on the air.**"

The spine agrees with the false claim: `market_days=frozen` (struck through), `assignment=done`.

The cause is in the design of the frozen state.
`frozenAtIndex` in `PhaseRail.vue` infers the furthest stage reached from evidence the market still holds - a stored assignment, a published application form - because **there is no record of which phases a market passed through**.
No evidence distinguishes "assigned, then archived" from "assigned, published, then archived", so it always stops at `assignment`, and the copy asserts the stronger claim anyway.

`E10/F01/S01` asked for the terminal state to be stated in words *"and why where known"*.
The code states a why it does not know.
That is the worst available outcome here, because the prototype's whole finding was that strikethrough alone reads as *stopped* rather than *archived* and the **words** are what carry the meaning.

### What to decide

**Whether a market keeps a record of the phases it has been through.**

- **No - say less.** "This market is archived." full stop, with the *why* omitted unless there is real evidence for it. Honest immediately, costs nothing, and gives up the detail the story wanted. The spine's freeze point stays a guess, so it should probably stop striking stages through at all rather than strike the wrong ones.
- **Yes - record it.** A furthest-phase-reached field, or a phase-transition log, stamped when a transition fires. Makes the rail's freeze point a fact. Opens: is it one field or a log; does it belong on the market document or beside it like `placement_history`; and is it worth it for one sentence on one screen.

The second answer is more than this sentence, which is why it is a decision rather than a fix.
A phase-transition record is the thing that would also answer "when did this market open applications", "who published it", and "how long was it in review" - none of which anything asks today.
Judge it on whether those are coming, not on the sentence alone.

### Notes

**Blocked by [02](02-source-of-truth-for-the-market-on-screen.md).**
If the answer is "record it", that new fact has to reach four screens freshly - which is precisely what 02 decides.
Designing the field before knowing how a screen gets its market would be designing half of it.

`placement_history` is the nearest precedent in the codebase: a separate collection, owned by one module, deleted with the market, deliberately narrow in scope. Its docstring argues for narrowness explicitly.

Findings: F14 in `.lavish/qc-2026-09-20.html`.
