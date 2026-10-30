---
layer: business
kind: rule
describes:
  - back-end/pricing.py
  - back-end/datatypes.py#PricingObject
  - back-end/datatypes.py#TierPrice
  - back-end/datatypes.py#PriceGroup
  - back-end/datatypes.py#AnswerCondition
  - back-end/guards.py#PriceGroupsStandGuard
  - back-end/api/applications.py#vendor_answers_for_market
  - back-end/api/markets.py#get_market_tables
  - front-end/src/components/elements/ElementPricing.vue
  - front-end/src/utils/pricing.ts
verified: 2026-10-30
sources:
  - T92
  - E43/F01/S01
  - E43/F01/S02
---

# A price follows the table

An assignment costs what its table costs for that day: the full-table price of the table's tier, or a half table's share of it when the vendor has half the table, even at a tier the vendor did not pick.
Which row of the card prices it is read from the vendor's own answers: the price groups the organizer names, the cheapest one they are in, or "Everyone else" when they are in none.
The prices are set on Market Setup's Pricing card, are optional, and settle with the rest of the setup on leaving draft.

**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

**A price is for one table on one market day** (Daniel, T92 Q4), so a vendor's cost is the sum of their assignments, one per date, and two vendors sharing a table each pay a half table.
**The price follows the table, not the vendor's answer** (Q20): a vendor assigned by hand at a tier they did not accept is priced at that tier, which is why such an assignment is flagged as one that sets their price ([why a vendor was not placed](why-a-vendor-was-not-placed.md)).
**A half table costs a share of the full price**, 50% unless the organizer says otherwise, because the organizers' own forms said so ("half off by default").
**The prices are set while the market is planned** (Q6), so they [settle with the setup on leaving draft](the-setup-settles-on-leaving-draft.md) and change again only if the market goes back.
**Pricing is optional**: a tier left blank has no price, and a market with no prices shows no price anywhere.
**What a vendor owes is the organizers' to read** (Q20.2): the price shows in the vendor drawer, never on the applicant's own pages.
**A vendor's row comes straight from their form answers** (Q5): checking a claim is the organizer's job in review, so an approved vendor's answers are taken as true, and no price is typed for one vendor by hand; Conventioner tracks what is expected, not accounting.
**The cheaper row wins** (Q6), so a vendor who fits two groups, or ticked both "student" and "alumni", pays the cheaper.
**The pricing is general, not one organizer's** (Q14): each market names its own groups over its own choice questions, the UBC table (three groups and "Everyone else", Gold and Silver) is one configuration of it, and no question of any one market's form is named in code.

## Price groups

- A group is a name the organizer gives ("UBC student + club member"), one or more conditions, and a full-table price per tier, a row above "Everyone else", which stays last and cannot be removed or named again.
- A condition is a choice question of the market's and the answers that meet it ("includes any of"), built with the [automatic rejections](automatic-rejections.md)' builder and judged as a rule is (`Rulebook.met`); a vendor is in a group when every one of its conditions holds.
- A group reads the vendor's answers as the organizer does, an update in place of their own answer ([an update is kept beside the vendor's answer](an-update-is-kept-beside-the-vendors-answer.md), read through `effective_answers` on [the application document](../../implementation/data/application-document.md#an-organizers-update-of-an-answer)); a vendor placed with no application is in no group.
- **The cheapest group is judged at each table-day's tier**: a group cheaper at Gold and another cheaper at Silver each price the days at their tier, the first on the card of two at one price.
  A group that leaves a tier blank does not price its vendors there: another group they are in does, or "Everyone else", and a group "Everyone else" undercuts still prices its own vendors: "Everyone else" is for who is in no group, not a cap.
- A group with no condition, or a condition with no answer ticked, holds nobody yet.
- **A condition on a question the form no longer asks as a choice, or on an answer it no longer offers, is broken**: it is kept and shown broken on the card, holds nobody, and keeps the market in draft with its own blocker line naming the group (`PriceGroupsStandGuard` in [`back-end/guards.py`](../../../back-end/guards.py), kept by [the guards](../../implementation/modules/guards.md), "Fix the price groups").
  It is kept rather than dropped, as an automatic rejection's rule is, because it decides what a vendor pays; and the form, like the prices, may change only in draft, so draft is where it is fixed.

## The amounts

- Prices are whole cents in the market's one currency, chosen on the card from Canadian, US, Australian and New Zealand dollars, euros and pounds sterling; Canadian dollars unless another is picked, since it is unverified that every market is in Canada.
- **A half price rounds half up to the cent**: 50% of $30.01 is $15.01, and 25% of $10.02 is $2.51 (`half_price`, integer arithmetic, so no float decides a cent).
- A tier's price is the same on every market date; a price per date was never asked for.
- A cell is a full table's price for one day, from $0 to $100,000; the share is a whole percent from 0 to 100.

## Who may

Changing the prices is part of "Change Market Setup", an Editor's ([what each role may do](what-each-role-may-do.md)); reading them is the market's people's, as the drawer is.

## Where it is kept

- The card is `pricing` on the plan (`setupObject.pricing`, `PricingObject`, `PriceGroup`, `AnswerCondition` and `TierPrice` in [`back-end/datatypes.py`](../../../back-end/datatypes.py); [the market document](../../implementation/data/market-document.md)): `currency`, `halfTablePercent`, `groups`, each `{name, conditions: [{key, answers}], prices}`, and `everyoneElse`, a list of `{tier, cents}`, one per tier the card prices.
  It is a list rather than a map by tier name because every market write camel-cases its keys, and a tier's name is the organizer's text.
- The plan write (`prepared_plan` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) refuses a price outside $0 to $100,000, a fraction of a cent, a price sent as text, an unknown currency and a share outside 0 to 100 as its models' own validation (`TierPrice` and `PricingObject` in [`back-end/datatypes.py`](../../../back-end/datatypes.py)), and a tier the plan does not have or one priced twice in a row, a group with no name, two groups of one name or one called "Everyone else", a condition whose key no form question could have (outside `FORM_FIELD_KEY_PATTERN` in `back-end/datatypes.py`, since the key reaches a Mongo projection of the answers) and two conditions in a group on one question (`pricing_refusal` in [`back-end/pricing.py`](../../../back-end/pricing.py)).
  It does not judge a condition against the form, so a form change never makes the plan unsavable; the tables read projects only whole conditions' keys, the form's own (`Groups.keys`).
  A change after draft is refused with the setup's own reason, since `setup_part` includes the prices; and each change is recorded in [the market's history](../../implementation/data/history.md) as a `pricing` entry, before and after.
- `Groups` in `back-end/pricing.py` prices one vendor's assignment from their answers (`price`) and names the broken groups (`broken`); the tables read (`get_market_tables`) reads the answers the groups ask (`vendor_answers`, through `vendor_answers_for_market` in [`back-end/api/applications.py`](../../../back-end/api/applications.py)) and carries each vendor's price on their table's row as `prices`, `{email, cents, group}`, empty where the table has none; `group` is the group's name, "Everyone else" on a card with groups, and null on a card without.
  The drawer's date cards read it there ("Gold, full table, UBC student + club member, $12", or "Gold, full table, $35" on a card with no groups; `priceLine` in [`front-end/src/utils/pricing.ts`](../../../front-end/src/utils/pricing.ts)).
- The card is [`ElementPricing.vue`](../../../front-end/src/components/elements/ElementPricing.vue), on [planning the market](../flows/planning.md#e9-pricing); a group's conditions are drawn by `ChoiceConditions.vue` (`front-end/src/components/application/`), and a broken one is judged on the screen by `brokenCondition` (`front-end/src/utils/choiceConditions.ts`) as the server judges it.
  A tier renamed in Tier Setup keeps its price in every row, and a removed tier's prices go with it (`pricingAfterTierChange`); a group with no name or another's holds the plan's autosave until it is fixed (`groupNameProblem`); a cell or the share holding text that is no value keeps the value from before it, no price for a cell that had none, and holds the plan's autosave (`held`, `planHeld` in `MarketSetupView.vue`) until it is fixed.
  That text moves with its tier's rename and goes with its tier, and the share's goes with the last tier, so no hold outlives its field.
- Each change of the card, its groups included, is one `pricing` entry in [the market's history](../../implementation/data/history.md), with who, when, and the fields before and after; it is about the market, not a vendor, so it names none.
- `back-end/tests/test_the_pricing_card.py`, `test_price_groups.py`, `front-end/src/__tests__/pricing.test.ts`, `elementPricing.test.ts`, `front-end/e2e/the-pricing-card.spec.ts` and `price-groups.spec.ts` (the UBC table) pin it.
