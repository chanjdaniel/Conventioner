import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { reactive } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ProposalLedger from '@/components/csvProposal/ProposalLedger.vue';
import {
  correct,
  draftFrom,
  toggleOption,
  type Proposal,
  type ProposedColumn,
  type ProposedOption,
} from '@/utils/csvProposal';

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
      upload: false,
      optionsByType: { select: { options: OPTIONS, answers: [] } },
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

const mounted: VueWrapper[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

/** The ledger as the view holds it, its corrections landing on the working copy, in the document. */
function ledger(proposal: Proposal = PROPOSAL) {
  const draft = reactive(draftFrom(proposal));
  const wrapper = mount(ProposalLedger, {
    attachTo: document.body,
    global: {
      plugins: [
        createRouter({
          history: createMemoryHistory(),
          routes: [{ path: '/', component: { render: () => null } }],
        }),
      ],
    },
    props: {
      proposal,
      draft,
      year: 2026,
      planDates: [],
      planTiers: ['Gold', 'Silver'],
      planCeiling: null,
      onCorrect: (row: number, change: Parameters<typeof correct>[2]) =>
        correct(draft, row, change),
      onToggle: (row: number, value: string) => toggleOption(draft, row, value),
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** `count` answers, every third one rare and so not kept, each word telling it from the others. */
const answers = (count: number, word = 'Answer'): ProposedOption[] =>
  Array.from({ length: count }, (_, at) => ({
    value: `${word} ${at}`,
    count: 10,
    rare: at % 3 === 2,
    keep: at % 3 !== 2,
  }));

/** A proposal whose question 0 offers `options`, and whose question 1 offers `second`. */
function proposalOf(options: ProposedOption[], second: ProposedOption[] = []): Proposal {
  const asked = (index: number, read: ProposedOption[]) => {
    const made = column(index);
    return {
      ...made,
      field: {
        ...made.field!,
        options: read,
        optionsByType: {
          select: { options: read, answers: [] },
          multi_select: { options: [read[0]], answers: [] },
        },
      },
    };
  };
  return {
    ...PROPOSAL,
    columns: second.length ? [asked(0, options), asked(1, second)] : [asked(0, options)],
  };
}

const rareSoap: ProposedOption = { value: 'Goat soap', count: 2, rare: true, keep: false };

const rowAt = (wrapper: VueWrapper, at = 0) => wrapper.findAll('[data-testid="proposal-row"]')[at];
const optionsOf = (row: ReturnType<typeof rowAt>) => row.findAll('[data-testid="proposal-option"]');
const findIn = (row: ReturnType<typeof rowAt>) =>
  row.find<HTMLInputElement>('[data-testid="proposal-row-list-find"]');
const moreIn = (row: ReturnType<typeof rowAt>) =>
  row.find('[data-testid="proposal-row-list-more"]');

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

  describe("a question's options", () => {
    it('draws the first 20, then every one by asking, then folds them', async () => {
      const row = rowAt(ledger(proposalOf(answers(229))));
      expect(optionsOf(row)).toHaveLength(20);
      expect(moreIn(row).text()).toBe('Show all 229');
      await moreIn(row).trigger('click');
      expect(optionsOf(row)).toHaveLength(229);
      expect(moreIn(row).text()).toBe('Show fewer');
      await moreIn(row).trigger('click');
      expect(optionsOf(row)).toHaveLength(20);
    });

    it('hands the focus to the first answer "Show all" brought', async () => {
      const row = rowAt(ledger(proposalOf(answers(30))));
      await moreIn(row).trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(optionsOf(row)[20].element);
    });

    it('offers no field at 12 answers, and one named "Find an answer" at 13', () => {
      expect(findIn(rowAt(ledger(proposalOf(answers(12))))).exists()).toBe(false);
      const row = rowAt(ledger(proposalOf(answers(13))));
      expect(findIn(row).exists()).toBe(true);
      expect(row.find(`label[for="${findIn(row).attributes('id')}"]`).text()).toBe(
        'Find an answer',
      );
    });

    it('finds an answer by its words, capitals aside, with its tick and count', async () => {
      const row = rowAt(ledger(proposalOf([...answers(30), rareSoap])));
      await findIn(row).setValue('  SOAP ');
      expect(optionsOf(row)).toHaveLength(1);
      expect(optionsOf(row)[0].text()).toContain('Goat soap');
      expect(optionsOf(row)[0].text()).toContain('chosen by 2 - keep?');
      expect(optionsOf(row)[0].classes()).toContain('rare');
      expect(row.find('[data-testid="proposal-row-list-count"]').text()).toBe(
        '1 of 31 matches "SOAP"',
      );
    });

    it('holds its place and its words through a tick', async () => {
      const row = rowAt(ledger(proposalOf([...answers(30), ...answers(30, 'Other')])));
      await findIn(row).setValue('Other');
      await moreIn(row).trigger('click');
      expect(optionsOf(row)).toHaveLength(30);

      const tick = optionsOf(row)[25].find<HTMLInputElement>('input');
      expect(tick.element.checked).toBe(true);
      await tick.setValue(false);

      expect(optionsOf(row)).toHaveLength(30);
      expect(findIn(row).element.value).toBe('Other');
      expect(optionsOf(row)[25].find<HTMLInputElement>('input').element.checked).toBe(false);
    });

    it('holds each question to its own words', async () => {
      const wrapper = ledger(proposalOf(answers(30), answers(30, 'Other')));
      await findIn(rowAt(wrapper, 0)).setValue('Answer 7');
      expect(optionsOf(rowAt(wrapper, 0))).toHaveLength(1);
      expect(findIn(rowAt(wrapper, 1)).element.value).toBe('');
      expect(optionsOf(rowAt(wrapper, 1))).toHaveLength(20);
    });

    it("keeps a row's words when its answers leave and come back", async () => {
      const wrapper = ledger(proposalOf(answers(30)));
      await findIn(rowAt(wrapper)).setValue('Answer 7');
      await rowAt(wrapper).find('[data-testid="proposal-row-fate"]').setValue('left_out');
      expect(findIn(rowAt(wrapper)).exists()).toBe(false);
      await rowAt(wrapper).find('[data-testid="proposal-row-fate"]').setValue('custom');
      expect(findIn(rowAt(wrapper)).element.value).toBe('Answer 7');
      expect(optionsOf(rowAt(wrapper))).toHaveLength(1);
    });

    it('goes back to its first answers when another type reads the file otherwise', async () => {
      const wrapper = ledger(proposalOf(answers(30)));
      await moreIn(rowAt(wrapper)).trigger('click');
      expect(optionsOf(rowAt(wrapper))).toHaveLength(30);
      await rowAt(wrapper).find('[data-testid="proposal-row-type"]').setValue('multi_select');
      await rowAt(wrapper).find('[data-testid="proposal-row-type"]').setValue('select');
      expect(optionsOf(rowAt(wrapper))).toHaveLength(20);
    });

    it('does nothing on Enter in the field, and nothing confirms the proposal', async () => {
      const wrapper = ledger(proposalOf(answers(30)));
      const before = optionsOf(rowAt(wrapper)).length;
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      findIn(rowAt(wrapper)).element.dispatchEvent(enter);
      await flushPromises();
      expect(enter.defaultPrevented).toBe(true);
      expect(wrapper.emitted('confirm')).toBeUndefined();
      expect(wrapper.emitted('correct')).toBeUndefined();
      expect(optionsOf(rowAt(wrapper))).toHaveLength(before);
    });

    describe('"Keep all"', () => {
      const keepAllIn = (row: ReturnType<typeof rowAt>) =>
        row.find('[data-testid="proposal-row-keep-all"]');

      it("stands with the field, in the frame's tools, and counts every answer", () => {
        const row = rowAt(ledger(proposalOf(answers(30))));
        const tools = row.find('[data-testid="proposal-row-list-tools"]');
        expect(tools.find('[data-testid="proposal-row-keep-all"]').text()).toBe('Keep all 30');
      });

      it('keeps every answer whatever the words have narrowed the list to', async () => {
        const wrapper = ledger(proposalOf(answers(30)));
        await findIn(rowAt(wrapper)).setValue('Answer 7');
        await keepAllIn(rowAt(wrapper)).trigger('click');
        const kept = wrapper.emitted('correct')?.[0]?.[1] as { kept: { select: string[] } };
        expect(kept.kept.select).toEqual(answers(30).map((o) => o.value));
        expect(findIn(rowAt(wrapper)).element.value).toBe('Answer 7');
      });

      it('leaves once every answer is kept, and with the field gone leaves no row of tools', async () => {
        const wrapper = ledger(proposalOf(answers(5)));
        expect(rowAt(wrapper).find('[data-testid="proposal-row-list-tools"]').exists()).toBe(true);
        await keepAllIn(rowAt(wrapper)).trigger('click');
        expect(keepAllIn(rowAt(wrapper)).exists()).toBe(false);
        expect(rowAt(wrapper).find('[data-testid="proposal-row-list-tools"]').exists()).toBe(false);
      });

      it('comes back when an answer is unticked', async () => {
        const wrapper = ledger(proposalOf(answers(5)));
        await keepAllIn(rowAt(wrapper)).trigger('click');
        await optionsOf(rowAt(wrapper))[0].find('input').setValue(false);
        expect(keepAllIn(rowAt(wrapper)).exists()).toBe(true);
      });
    });

    it('says nothing of a count on a short list', () => {
      const row = rowAt(ledger(proposalOf(answers(5))));
      expect(row.find('[data-testid="proposal-row-list-count"]').exists()).toBe(false);
      expect(moreIn(row).exists()).toBe(false);
    });
  });
});
