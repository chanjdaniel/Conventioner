---
layer: business
kind: rule
describes:
  - back-end/pricing.py
  - back-end/datatypes.py#PricingObject
  - back-end/datatypes.py#TierPrice
  - back-end/api/markets.py#get_market_tables
  - front-end/src/components/elements/ElementPricing.vue
  - front-end/src/utils/pricing.ts
verified: 2026-10-30
sources:
  - T92
  - E43/F01/S01
---

# A price follows the table

An assignment costs what its table costs for that day: the full-table price of the table's tier, or a half table's share of it when the vendor has half the table, even at a tier the vendor did not pick.
The prices are set on Market Setup's Pricing card, are optional, and settle with the rest of the setup on leaving draft.

**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

**A price is for one table on one market day** (Daniel, T92 Q4), so a vendor's cost is the sum of their assignments, one per date, and two vendors sharing a table each pay a half table.
**The price follows the table, not the vendor's answer** (Q20): a vendor assigned by hand at a tier they did not accept is priced at that tier, which is why such an assignment is flagged as one that sets their price ([why a vendor was not placed](why-a-vendor-was-not-placed.md)).
**A half table costs a share of the full price**, 50% unless the organizer says otherwise, because the organizers' own forms said so ("half off by default").
**The prices are set while the market is planned** (Q6), so they [settle with the setup on leaving draft](the-setup-settles-on-leaving-draft.md) and change again only if the market goes back.
**Pricing is optional**: a tier left blank has no price, and a market with no prices shows no price anywhere.
**What a vendor owes is the organizers' to read** (Q20.2): the price shows in the vendor drawer, never on the applicant's own pages.
**The card speaks of tiers only** (Q14): no question of any one market's form is read or named.
Conventioner tracks what is expected, not accounting (Q5): no price is typed for one vendor by hand.

## The amounts

- Prices are whole cents in the market's one currency, chosen on the card from Canadian, US, Australian and New Zealand dollars, euros and pounds sterling; Canadian dollars unless another is picked, since it is unverified that every market is in Canada.
- **A half price rounds half up to the cent**: 50% of $30.01 is $15.01, and 25% of $10.02 is $2.51 (`half_price`, integer arithmetic, so no float decides a cent).
- A tier's price is the same on every market date; a price per date was never asked for.
- A cell is a full table's price for one day, from $0 to $100,000; the share is a whole percent from 0 to 100.

## Who may

Changing the prices is part of "Change Market Setup", an Editor's ([what each role may do](what-each-role-may-do.md)); reading them is the market's people's, as the drawer is.

## Where it is kept

- The card is `pricing` on the plan (`setupObject.pricing`, `PricingObject` and `TierPrice` in [`back-end/datatypes.py`](../../../back-end/datatypes.py); [the market document](../../implementation/data/market-document.md)): `currency`, `halfTablePercent` and `everyoneElse`, a list of `{tier, cents}`, one per tier the card prices.
  It is a list rather than a map by tier name because every market write camel-cases its keys, and a tier's name is the organizer's text.
- The plan write (`prepared_plan` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) refuses a price outside $0 to $100,000, a fraction of a cent, a price sent as text, an unknown currency and a share outside 0 to 100 as its models' own validation (`TierPrice` and `PricingObject` in [`back-end/datatypes.py`](../../../back-end/datatypes.py)), and a tier the plan does not have or one priced twice (`pricing_refusal` in [`back-end/pricing.py`](../../../back-end/pricing.py)).
  A change after draft is refused with the setup's own reason, since `setup_part` includes the prices; and each change is recorded in [the market's history](../../implementation/data/history.md) as a `pricing` entry, before and after.
- `assignment_price` in `back-end/pricing.py` prices one assignment; the tables read (`get_market_tables`) carries each vendor's price on their table's row as `prices`, `{email, cents}`, empty where the table has none.
  The drawer's date cards read it there ("Gold, full table, $35"; `priceLine` in [`front-end/src/utils/pricing.ts`](../../../front-end/src/utils/pricing.ts)).
- The card is [`ElementPricing.vue`](../../../front-end/src/components/elements/ElementPricing.vue), on [planning the market](../flows/planning.md#e9-pricing); a tier renamed in Tier Setup keeps its price, and a removed tier's price goes with it (`pricingAfterTierChange`); a cell or the share holding text that is no value keeps the value from before it, no price for a cell that had none, and holds the plan's autosave (`held`, `planHeld` in `MarketSetupView.vue`) until it is fixed.
  That text moves with its tier's rename and goes with its tier, and the share's goes with the last tier, so no hold outlives its field.
- `back-end/tests/test_the_pricing_card.py`, `front-end/src/__tests__/pricing.test.ts`, `elementPricing.test.ts` and `front-end/e2e/the-pricing-card.spec.ts` pin it.
