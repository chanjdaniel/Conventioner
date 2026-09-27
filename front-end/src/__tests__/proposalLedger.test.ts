import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ProposalLedger from '@/components/csvProposal/ProposalLedger.vue';
import { draftFrom, type Proposal, type ProposedColumn } from '@/utils/csvProposal';

const OPTIONS = [
  { value: 'Yes', count: 8, rare: false, keep: true },
  { value: 'Maybe', count: 2, rare: true, keep: false },
];

function column(index: number, overrides: Partial<ProposedColumn> = {}): ProposedColumn {
  return {
    index,
    header: `Question ${index}`,
    group: null,
    answered: 10,
    firstAnswers: [],
    fate: 'custom',
    essential: null,
    leftOut: null,
    why: 'A question of your own',
    check: [],
    field: {
      key: `question_${index}`,
      label: `Question ${index}`,
      helpText: null,
      type: 'select',
      required: false,
      options: OPTIONS,
      unlistedOptions: 0,
      upload: false,
      optionsByType: { select: { options: OPTIONS, unlisted: 0 } },
    },
    ...overrides,
  };
}

const PROPOSAL: Proposal = {
  rowCount: 10,
  responses: 10,
  columns: [column(0), column(1, { fate: 'essential', essential: 'essential_full_name' })],
  plan: {
    dates: [],
    year: null,
    tiers: [{ name: 'Bronze', matches: null }],
    ceiling: null,
    disagreements: [{ kind: 'tier', value: 'Bronze' }],
    check: [],
  },
  notAsked: [],
  typesafe: { asked: false },
};

function ledger() {
  return mount(ProposalLedger, {
    props: {
      proposal: PROPOSAL,
      draft: draftFrom(PROPOSAL),
      year: 2026,
      planDates: [],
      planTiers: ['Gold', 'Silver'],
    },
  });
}

describe('the proposal ledger', () => {
  it('asks for a correction when a column is given a new fate', async () => {
    const wrapper = ledger();
    await wrapper.findAll('[data-testid="proposal-row-fate"]')[0].setValue('left_out');
    expect(wrapper.emitted('correct')?.[0]).toEqual([0, { fate: 'left_out', essential: null }]);
  });

  it('offers an essential question only to one column', () => {
    const wrapper = ledger();
    const menu = wrapper.findAll('[data-testid="proposal-row-fate"]')[0];
    const fullName = menu.find('option[value="essential:essential_full_name"]');
    expect(fullName.attributes('disabled')).toBeDefined();
    expect(fullName.text()).toContain('(column 2)');
  });

  it('shows a rare option unticked, with how many chose it, and asks to keep it', async () => {
    const wrapper = ledger();
    const rare = wrapper.findAll('[data-testid="proposal-option"]')[1];
    expect(rare.text()).toContain('chosen by 2 - keep?');
    expect((rare.find('input').element as HTMLInputElement).checked).toBe(false);
    await rare.find('input').setValue(true);
    expect(wrapper.emitted('toggle')?.[0]).toEqual([0, 'Maybe']);
  });

  it("settles a tier the plan does not have with the import's own fix", async () => {
    const wrapper = ledger();
    await wrapper.find('[data-testid="proposal-fix-Bronze"]').setValue('Silver');
    expect(wrapper.emitted('settle')?.[0]).toEqual(['tier', 'Bronze', 'Silver']);
  });
});
