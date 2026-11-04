// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h } from 'vue';

import DraftedFrom from '@/components/market/DraftedFrom.vue';
import {
  IntakeMode,
  MarketPhase,
  type Market,
  type PreconditionResult,
} from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const Blank = defineComponent({ render: () => h('div') });

const noLocation: PreconditionResult = {
  id: 'has_location',
  passed: false,
  message: 'This market has no location. Add one on Market Setup.',
  resolutionLink: 'setup',
  resolutionLabel: 'Add a location',
  resolutionAction: MarketAction.ChangeSetup,
};

const noTables: PreconditionResult = {
  id: 'has_tables',
  passed: false,
  message: 'This market has no tables yet. Add a section with tables on Market Setup.',
  resolutionLink: 'setup',
  resolutionLabel: 'Add tables',
  resolutionAction: MarketAction.ChangeSetup,
};

const noQuestions: PreconditionResult = {
  id: 'form_has_fields',
  passed: false,
  message: 'The application form asks nothing.',
};

/** What the import fills in itself: never "still needed" before it. */
const nothingImported: PreconditionResult = {
  id: 'responses_imported',
  passed: false,
  message: "Nothing has been imported yet. Import your Google Form's responses first.",
};

function marketWith(
  intakeMode: IntakeMode,
  blockers: PreconditionResult[],
  actionRefusals = answersRefusing(),
): Market {
  return {
    id: 'm1',
    name: 'Spring Market',
    phase: MarketPhase.Draft,
    intakeMode,
    actionRefusals,
    transitionBlockers: { applications: blockers },
  } as unknown as Market;
}

async function mountNotice(market: Market, fileName = 'five-day-grid.csv') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
  });
  await router.push('/markets/m1/form');
  await router.isReady();
  return mount(DraftedFrom, { props: { market, fileName }, global: { plugins: [router] } });
}

const DRAFTED = 'Drafted from five-day-grid.csv. No responses were imported.';
const IMPORT_NEXT =
  "Import them with Import responses, the next step at the top of the market's pages";

describe('DraftedFrom', () => {
  it('says only what the file drafted on a market whose vendors apply on its page', async () => {
    const wrapper = await mountNotice(marketWith(IntakeMode.Form, [noLocation, noTables]));

    expect(wrapper.text()).toBe(DRAFTED);
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('on a Google Form market, says the import comes next and lists what it waits on, each a link', async () => {
    const wrapper = await mountNotice(
      marketWith(IntakeMode.Csv, [noLocation, nothingImported, noTables]),
    );

    expect(wrapper.text()).toContain(DRAFTED);
    expect(wrapper.text()).toContain(`${IMPORT_NEXT}, once the market is ready.`);
    expect(wrapper.text()).toContain('Still needed before the import: Add a location, Add tables.');
    expect(wrapper.text()).not.toContain('Nothing has been imported yet');
    const links = wrapper.findAll('a');
    expect(links.map((link) => link.text())).toEqual(['Add a location', 'Add tables']);
    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/markets/m1/setup',
      '/markets/m1/setup',
    ]);
  });

  it('reads an absent intake as a Google Form market, as the server does', async () => {
    const market = marketWith(IntakeMode.Csv, [noTables]);
    delete (market as Partial<Market>).intakeMode;
    const wrapper = await mountNotice(market);

    expect(wrapper.text()).toContain('Still needed before the import: Add tables.');
  });

  it('says a blocker as its message, with no link, to someone who may not fix it', async () => {
    const wrapper = await mountNotice(
      marketWith(IntakeMode.Csv, [noLocation, noTables], answersRefusing(MarketAction.ChangeSetup)),
    );

    expect(wrapper.text()).toContain(
      `Still needed before the import: ${noLocation.message} ${noTables.message}`,
    );
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('says a blocker with no link as its message, after the links', async () => {
    const wrapper = await mountNotice(marketWith(IntakeMode.Csv, [noQuestions, noTables]));

    expect(wrapper.text()).toContain(
      `Still needed before the import: Add tables. ${noQuestions.message}`,
    );
    expect(wrapper.findAll('a').map((link) => link.text())).toEqual(['Add tables']);
  });

  it('lists nothing, and drops "once the market is ready", when nothing is left before the import', async () => {
    const wrapper = await mountNotice(marketWith(IntakeMode.Csv, [nothingImported]));

    expect(wrapper.text()).toBe(`${DRAFTED} ${IMPORT_NEXT}.`);
    expect(wrapper.text()).not.toContain('Still needed');
    expect(wrapper.text()).not.toContain('once the market is ready');
  });

  it('drops a blocker from the line once the market is read without it', async () => {
    const wrapper = await mountNotice(marketWith(IntakeMode.Csv, [noLocation, noTables]));
    await wrapper.setProps({ market: marketWith(IntakeMode.Csv, [noTables]) });

    expect(wrapper.text()).toContain('Still needed before the import: Add tables.');
    expect(wrapper.text()).not.toContain('Add a location');
  });

  it('is a status notice, not an alert', async () => {
    const wrapper = await mountNotice(marketWith(IntakeMode.Form, []));

    expect(wrapper.get('[data-testid="drafted-from"]').attributes('role')).toBe('status');
  });
});
