# 02: What is the source of truth for the market a screen is showing?

Type: grilling
Status: open
Blocked by: -

## Question

The same market shows two different phases on two screens at the same moment.

With the server holding `applications_open` and the browser's cached copy holding `draft`:

- `/market-setup` rail reads **"Draft"**
- `/markets/:id/tables` rail reads **"Applications Open"**

Same market, same browser, same second, surviving a full page navigation.

The two halves of the phase rail read the market differently.
Tables and Attendance use `useRailMarket` (`utils/railMarket.ts`), which GETs the market by id.
Market Setup and Vendors read `localStorage.getItem('market')` and never re-fetch on mount, so a phase changed anywhere else is invisible to them indefinitely.

Everything derived from the phase inherits the staleness.
The import banner says *"This market is still a draft, so it is not taking applications yet"* about a market that is taking applications.
The Assign hint names the wrong next step.
Both are correct code reading a wrong input.

It became load-bearing with `E10/F01`: before the rail, the phase appeared on one screen, and now a stale copy is stated on four.
Any second tab, second device, or co-organizer hits it - and markets carry owner/admin/editor roles, so more than one person editing a market is a supported case, not an edge.

### What to decide

**Where a screen gets the market it is displaying**, and what guarantees that answer carries.

Candidate answers, cheapest first:

- **Everything fetches.** Point the two stragglers at `useRailMarket`. Smallest diff; leaves `localStorage` as a cache of convenience and leaves open what happens when two tabs write it.
- **Fetch on mount, cache for the session.** What Tables does today, made uniform.
- **Route by market id.** The four organizer routes that take no parameters (`/market-setup`, `/vendors`, `/import-applications`, `/assignment-results`) read `localStorage.market`, which is *why* there is a cache to go stale. Routing by id removes the question rather than answering it.

The third was ruled out of scope on the previous map, as *"a refactor justified by deep links and shareable URLs, none of which is something the organizer is told falsely."*
This finding is something the organizer is told falsely, so it is back on the table **as a candidate answer, not a precondition**.
If it wins, that redraws the earlier ruling deliberately rather than by accident, and this ticket should say so.

Worth deciding alongside: whether the market in `localStorage` should carry a phase at all, or only an id and a name.
A cached id cannot go stale about a lifecycle.

### Notes

`PhaseRail.doTransition` already re-fetches and rewrites `localStorage` after a transition it fires itself, so transitions made *on* a screen are fine.
The problem is only changes made anywhere else.

Findings: F7 in `.lavish/qc-2026-09-20.html`.
