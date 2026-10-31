import { expect, type APIRequestContext } from '@playwright/test';
import { SEED_MARKET_DATE, ensureTestOrgAuthenticated, loginViaApi } from './seeds';
import { uniqueMarketName } from './uniqueName';

/**
 * The Example College market: Gold and Silver on two dates, and the form's two questions its price
 * groups read, whether the vendor is a student or alumni and which clubs they are in. The table
 * of three groups and "Everyone else" is one configuration of the general Pricing card
 * (E43/F01/S02); the code names none of its questions.
 */
export const SECOND_DATE = '2099-05-08';
export const GOLD = { id: 1, name: 'Gold' };
export const SILVER = { id: 2, name: 'Silver' };
export const STUDENT = 'Current Example College student';
export const ALUMNI = 'Example College alumni/staff';
export const CLUBS = ['Art Club', 'Craft Club'];
export const NO_CLUB = 'Not in any of these clubs';

export const PLAN = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }, { date: SECOND_DATE }],
  tiers: [GOLD, SILVER],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
    { name: 'Landing', location: { name: 'Main Hall' }, tier: SILVER, count: 2 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 50 },
};

export const FORM = {
  fields: [
    {
      key: 'affiliation',
      label: 'Are you an Example College student or alumni?',
      type: 'multi_select',
      required: false,
      options: [STUDENT, ALUMNI],
      order: 0,
    },
    {
      key: 'clubs',
      label: 'Do you belong to any of these clubs?',
      type: 'multi_select',
      required: false,
      options: [...CLUBS, NO_CLUB],
      order: 1,
    },
  ],
};

/** The groups as an organizer enters them on the card: a name, its conditions, Gold and Silver. */
export const EXAMPLE_GROUPS = [
  {
    name: 'Example College student + club member',
    conditions: [
      { key: 'affiliation', answers: [STUDENT] },
      { key: 'clubs', answers: CLUBS },
    ],
    prices: ['12', '10'],
  },
  {
    name: 'Example College student only',
    conditions: [{ key: 'affiliation', answers: [STUDENT] }],
    prices: ['15', '13'],
  },
  {
    name: 'Example College alumni + club member',
    conditions: [
      { key: 'affiliation', answers: [ALUMNI] },
      { key: 'clubs', answers: CLUBS },
    ],
    prices: ['25', '22'],
  },
];

/** The card as the plan's write stores it: each group's prices in cents, "Everyone else" $35 and $30. */
export const EXAMPLE_PRICING = {
  currency: 'CAD',
  halfTablePercent: 50,
  groups: EXAMPLE_GROUPS.map((group) => ({
    name: group.name,
    conditions: group.conditions,
    prices: [
      { tier: 'Gold', cents: Number(group.prices[0]) * 100 },
      { tier: 'Silver', cents: Number(group.prices[1]) * 100 },
    ],
  })),
  everyoneElse: [
    { tier: 'Gold', cents: 3500 },
    { tier: 'Silver', cents: 3000 },
  ],
};

/** A draft market on the vendors' own page, with Gold and Silver and the Example College form's
 *  questions, and no prices yet. */
export async function seedExampleMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  label = 'E2E Price Groups',
) {
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);
  const name = uniqueMarketName(label);
  const created = await request.post(`${baseURL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: {
      name,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [userId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
      setupObject: PLAN,
      intakeMode: 'form',
    },
  });
  expect(created.ok(), `create the market: ${await created.text()}`).toBeTruthy();
  const { market_id: marketId } = (await created.json()) as { market_id: string };
  const form = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    data: FORM,
  });
  expect(form.ok(), `write the form: ${await form.text()}`).toBeTruthy();
  return { marketId, name };
}
