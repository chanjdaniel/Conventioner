---
layer: business
kind: intent
verified: 2026-10-21
sources:
  - E07
  - E26/F08
---

# A request can only do what its session may

A request does only what the person behind it is allowed to do, as their session or sign-in proves them.
Which organizer is asking comes from their session alone, never from anything the request carries; what they may do on a market comes from the role that market gives them; and the server decides both.
Each screen offers a person only the controls their role lets them use.
A vendor holds no session: their sign-in is a token naming one market and one address, and it reaches only the application found by those two.

## Why

A market holds its applicants' names, addresses and answers, and the organizer's verdicts on them; a stranger who can read or change them is a breach, not a bug.
Two holes were proven by request: a second account read a market's every applicant and rejected one of them by naming the market's owner in a header the client sets, and an anonymous request deleted a verified account.
A sign-in proves someone is signed in, never that they are who the request says, so nothing a caller sends may name the caller.
And a control the server would refuse is a control that lies: a Viewer shown every editing control saw each edit appear to work until its save failed.

## Rules

- [What each role may do](../rules/what-each-role-may-do.md): who is asking, and what their role on the market lets them change, decided by the server.
- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md): a vendor proves their address with a code, and the sign-in names the person and the market.

## Flows

- [Accounts](../flows/accounts.md): registering, verifying and signing in, which is what makes a session.
- [Organizations](../flows/organizations.md): an organization's people, and what each may change.
- [Ending and managing a market](../flows/ending-and-managing-a-market.md): who has access to a market, and who may delete it.
