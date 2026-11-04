/**
 * Changing a market role asks first, and says what it changes on this market (T211).
 *
 * A slip of a role select in Manage market changed someone's access at once, while Remove and a
 * permission row's change both ask first. Choosing a role now opens a confirmation naming the
 * person, the role they hold and the role chosen, with what they gain or lose read from this
 * market's own table. Cancel, Escape and the backdrop put the select back; a refusal closes the
 * confirmation, re-reads the list and is said beneath the row, where it has always been said.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import {
  MarketPhase,
  MarketRole,
  type Market,
  type PermissionTableRow,
  type PersonWithAccess,
} from '@/assets/types/datatypes';
import { marketRoleChange } from '@/utils/peopleWithAccess';
import { answersRefusing, EDITOR_ANSWERS } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const EMAIL = 'e2e@example.com';

function person(overrides: Partial<PersonWithAccess> = {}): PersonWithAccess {
  return {
    userId: 'u-walk',
    email: EMAIL,
    role: MarketRole.Viewer,
    marketRole: MarketRole.Viewer,
    organizationRole: null,
    fromOrganization: false,
    ...overrides,
  };
}

function row(label: string, role: MarketRole): PermissionTableRow {
  return {
    id: label,
    group: 'Reading',
    label,
    role,
    default: role,
    source: 'built-in',
    fixed: false,
    mayWhat: label,
  };
}

const TABLE = [
  row('Read the market', MarketRole.Viewer),
  row('Check vendors in', MarketRole.Editor),
  row('Change the setup', MarketRole.Editor),
  row('Publish results', MarketRole.Admin),
  row('Delete the market', MarketRole.Owner),
];

describe('what changing a market role says', () => {
  const change = (held: MarketRole, role: MarketRole, table = TABLE) =>
    marketRoleChange(person({ role: held, marketRole: held }), role, 'Spring Market', table);

  it('names the person, the role chosen and the role held, each with its article', () => {
    expect(change(MarketRole.Viewer, MarketRole.Editor).title).toBe(
      'Make e2e@example.com an Editor?',
    );
    expect(change(MarketRole.Viewer, MarketRole.Admin).title).toBe(
      'Make e2e@example.com an Admin?',
    );
    expect(change(MarketRole.Editor, MarketRole.Viewer).title).toBe(
      'Make e2e@example.com a Viewer?',
    );
    expect(change(MarketRole.Viewer, MarketRole.Editor).was).toBe(
      'They are a Viewer on Spring Market now.',
    );
    expect(change(MarketRole.Admin, MarketRole.Editor).was).toBe(
      'They are an Admin on Spring Market now.',
    );
  });

  it('lists what moving up gives: the rows above the role held, up to the role chosen', () => {
    expect(change(MarketRole.Viewer, MarketRole.Editor)).toMatchObject({
      kind: 'gains',
      lead: 'As an Editor they could also:',
      rows: ['Check vendors in', 'Change the setup'],
    });
    expect(change(MarketRole.Viewer, MarketRole.Admin).rows).toEqual([
      'Check vendors in',
      'Change the setup',
      'Publish results',
    ]);
  });

  it('lists what moving down takes: the rows above the role chosen, up to the role held', () => {
    expect(change(MarketRole.Editor, MarketRole.Viewer)).toMatchObject({
      kind: 'loses',
      lead: 'As a Viewer they could no longer:',
      rows: ['Check vendors in', 'Change the setup'],
    });
    expect(change(MarketRole.Admin, MarketRole.Editor)).toMatchObject({
      kind: 'loses',
      lead: 'As an Editor they could no longer:',
      rows: ['Publish results'],
    });
  });

  it("reads this market's own table, whose owner moved a row, not the defaults", () => {
    const moved = [
      row('Read the market', MarketRole.Viewer),
      // The default reads Editor; this market's owner raised it to Admin.
      { ...row('Check vendors in', MarketRole.Admin), default: MarketRole.Editor },
      // The default reads Admin; this market's owner lowered it to Editor.
      { ...row('Publish results', MarketRole.Editor), default: MarketRole.Admin },
    ];
    expect(change(MarketRole.Viewer, MarketRole.Editor, moved).rows).toEqual(['Publish results']);
    expect(change(MarketRole.Admin, MarketRole.Editor, moved).rows).toEqual(['Check vendors in']);
  });

  it('says so when no row lies between the two roles', () => {
    const alike = [row('Read the market', MarketRole.Viewer), row('Publish', MarketRole.Admin)];
    expect(change(MarketRole.Viewer, MarketRole.Editor, alike)).toMatchObject({
      kind: 'alike',
      lead: "This market's permissions treat the two roles alike, so nothing they may do changes.",
      rows: [],
    });
    expect(change(MarketRole.Editor, MarketRole.Viewer, alike).kind).toBe('alike');
  });
});

const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

function refusing(status: number, error: string): AxiosError {
  return Object.assign(new AxiosError('refused'), { response: { status, data: { error } } });
}

const OWNER = person({
  userId: 'u-owner',
  email: 'owner@example.com',
  role: MarketRole.Owner,
  marketRole: MarketRole.Owner,
});

function market(people: PersonWithAccess[], overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Spring Market',
    phase: MarketPhase.Applications,
    organizationId: 'org-1',
    organizationName: 'Seed Test Org',
    roles: {},
    inOrganization: true,
    actionRefusals: answersRefusing(),
    permissionTable: TABLE,
    peopleWithAccess: [OWNER, ...people],
    ...overrides,
  } as unknown as Market;
}

describe('Manage market asks before it changes a role', () => {
  let served: Market;

  beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockReset();
    api.put.mockReset();
    api.post.mockReset();
    document.body.innerHTML = '';
    served = market([person()]);
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: served } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
  });

  async function open() {
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: served },
      attachTo: document.body,
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
  }

  const select = () => byTestId('manage-market-role-select') as HTMLSelectElement;

  /** Choosing a role as a person does: the select holds focus, and the browser fires a change. */
  async function choose(role: MarketRole) {
    const element = select();
    element.focus();
    element.value = role;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    return element;
  }

  it('sends nothing on choosing, and names the person and both roles', async () => {
    const wrapper = await open();
    const element = await choose(MarketRole.Editor);

    expect(api.put).not.toHaveBeenCalled();
    expect(byTestId('manage-market-role-change-window')!.getAttribute('aria-label')).toBe(
      'Make e2e@example.com an Editor?',
    );
    expect(byTestId('manage-market-role-change-was')!.textContent?.trim()).toBe(
      'They are a Viewer on Spring Market now.',
    );
    const gains = byTestId('manage-market-role-change-gains')!;
    expect(gains.textContent).toContain('As an Editor they could also:');
    expect([...gains.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Check vendors in',
      'Change the setup',
    ]);
    expect(byTestId('manage-market-role-change-submit-button')!.textContent?.trim()).toBe(
      'Change role',
    );
    // Behind the dialog the select shows what was chosen.
    expect(element.value).toBe(MarketRole.Editor);
    // A role change is undone by another, so it is no destructive dialog.
    expect(byTestId('manage-market-role-change-submit-button')!.className).not.toContain(
      'btn--destructive',
    );
    wrapper.unmount();
  });

  it('says so in the dialog, with no list, when no row lies between the two roles', async () => {
    served = market([person()], {
      permissionTable: [
        row('Read the market', MarketRole.Viewer),
        row('Publish', MarketRole.Admin),
      ],
    });
    const wrapper = await open();
    await choose(MarketRole.Editor);

    const alike = byTestId('manage-market-role-change-alike')!;
    expect(alike.textContent?.trim()).toBe(
      "This market's permissions treat the two roles alike, so nothing they may do changes.",
    );
    expect(alike.querySelector('ul')).toBeNull();
    expect(byTestId('manage-market-role-change-gains')).toBeNull();
    expect(byTestId('manage-market-role-change-loses')).toBeNull();
    wrapper.unmount();
  });

  it('asks nothing when the role already held is chosen', async () => {
    const wrapper = await open();
    await choose(MarketRole.Viewer);

    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  for (const [how, close] of [
    ['Cancel', () => byTestId('manage-market-role-change-cancel-button')!.click()],
    ['Escape', escape],
    ['the backdrop', () => byTestId('manage-market-role-change-background')!.click()],
  ] as const) {
    it(`${how} closes only the confirmation, sends nothing, and puts the select back`, async () => {
      const wrapper = await open();
      const element = await choose(MarketRole.Editor);

      close();
      await flushPromises();

      expect(byTestId('manage-market-role-change-window')).toBeNull();
      expect(byTestId('manage-market-window')).not.toBeNull();
      expect(api.put).not.toHaveBeenCalled();
      expect(element.value).toBe(MarketRole.Viewer);
      expect(document.activeElement).toBe(element);
      wrapper.unmount();
    });
  }

  it('changes the role on confirm, in place, the dialog open, and focus on the select', async () => {
    api.put.mockImplementation(async () => {
      served = market([person({ role: MarketRole.Editor, marketRole: MarketRole.Editor })]);
      return { data: {} };
    });
    const wrapper = await open();
    const element = await choose(MarketRole.Editor);

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/markets/market-1/roles/u-walk', {
      role: MarketRole.Editor,
    });
    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(byTestId('manage-market-window')).not.toBeNull();
    expect(select()).toBe(element);
    expect(element.value).toBe(MarketRole.Editor);
    expect(document.activeElement).toBe(element);
    wrapper.unmount();
  });

  it('stays busy until it closes: inert, disabled, and no second write', async () => {
    let answer!: (value: { data: object }) => void;
    api.put.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const wrapper = await open();
    await choose(MarketRole.Editor);

    const confirm = byTestId('manage-market-role-change-submit-button') as HTMLButtonElement;
    confirm.click();
    await flushPromises();
    expect(confirm.disabled).toBe(true);

    // The form's own submit, which Enter would fire, and each way out, all inert while it writes.
    confirm.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    byTestId('manage-market-role-change-cancel-button')!.click();
    escape();
    byTestId('manage-market-role-change-background')!.click();
    await flushPromises();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(byTestId('manage-market-role-change-window')).not.toBeNull();

    answer({ data: {} });
    await flushPromises();
    expect(byTestId('manage-market-role-change-window')).toBeNull();
    wrapper.unmount();
  });

  it('says the same words until it closes, though the re-read names the market differently', async () => {
    const wrapper = await open();
    await choose(MarketRole.Editor);
    const seen: string[] = [];
    const read = () => {
      const was = byTestId('manage-market-role-change-was')?.textContent?.trim();
      if (was && seen[seen.length - 1] !== was) seen.push(was);
    };
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    read();
    api.put.mockImplementation(async () => {
      served = market([person({ role: MarketRole.Editor, marketRole: MarketRole.Editor })], {
        name: 'A Renamed Market',
      });
      return { data: {} };
    });

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();
    observer.disconnect();

    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(wrapper.text()).toContain('A Renamed Market');
    expect(seen).toEqual(['They are a Viewer on Spring Market now.']);
    wrapper.unmount();
  });

  it('puts focus on the people list when the person looking changed their own role away', async () => {
    served = market([
      person({
        userId: 'u-me',
        email: 'me@example.com',
        role: MarketRole.Editor,
        marketRole: MarketRole.Editor,
      }),
    ]);
    api.put.mockImplementation(async () => {
      // A Viewer now: the table no longer lets them change a role, so the select becomes a word.
      served = market(
        [
          person({
            userId: 'u-me',
            email: 'me@example.com',
            role: MarketRole.Viewer,
            marketRole: MarketRole.Viewer,
          }),
        ],
        { actionRefusals: EDITOR_ANSWERS },
      );
      return { data: {} };
    });
    const wrapper = await open();
    await choose(MarketRole.Viewer);

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-role-select')).toBeNull();
    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(document.activeElement).toBe(byTestId('manage-market-people'));
    wrapper.unmount();
  });

  it('closes on a refusal, puts the select back, and says the words under the row', async () => {
    api.put.mockRejectedValue(refusing(403, 'You cannot make that change.'));
    const wrapper = await open();
    const element = await choose(MarketRole.Editor);

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(element.value).toBe(MarketRole.Viewer);
    expect(byTestId('manage-market-user-error')!.textContent?.trim()).toBe(
      'You cannot make that change.',
    );
    expect(byTestId('manage-market-role-change-error')).toBeNull();
    expect(byTestId('manage-market-error')).toBeNull();
    expect(document.activeElement).toBe(element);
    wrapper.unmount();
  });

  it('on a refusal, re-reads the list, so the row states the role the server holds', async () => {
    api.put.mockImplementation(async () => {
      // Someone else made them an Admin first, which this reader may not take.
      served = market([person({ role: MarketRole.Admin, marketRole: MarketRole.Admin })]);
      throw refusing(403, 'You cannot make that change.');
    });
    const wrapper = await open();
    const element = await choose(MarketRole.Editor);

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(element.value).toBe(MarketRole.Admin);
    expect(byTestId('manage-market-user-error')!.textContent?.trim()).toBe(
      'You cannot make that change.',
    );
    expect(document.activeElement).toBe(element);
    wrapper.unmount();
  });

  it('keeps the words in reach, naming them, when the refused row has gone from the list', async () => {
    api.put.mockImplementation(async () => {
      // Someone else removed them first.
      served = market([]);
      throw refusing(400, 'User does not have a role in this market');
    });
    const wrapper = await open();
    await choose(MarketRole.Editor);

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-role-change-window')).toBeNull();
    const people = byTestId('manage-market-people')!;
    expect(people.textContent).not.toContain(`${EMAIL}'s role`);
    expect(people.querySelectorAll('[data-testid="manage-market-person"]')).toHaveLength(1);
    expect(byTestId('manage-market-user-error')!.textContent?.trim()).toBe(
      `${EMAIL}: User does not have a role in this market`,
    );
    expect(people.contains(byTestId('manage-market-user-error'))).toBe(true);
    expect(document.activeElement).toBe(people);
    wrapper.unmount();
  });

  it('takes the words away once the refused person is added back, with their row', async () => {
    api.put.mockImplementation(async () => {
      // Someone else removed them first.
      served = market([]);
      throw refusing(400, 'User does not have a role in this market');
    });
    api.post.mockImplementation(async () => {
      served = market([person({ role: MarketRole.Editor, marketRole: MarketRole.Editor })]);
      return { data: {} };
    });
    const wrapper = await open();
    await choose(MarketRole.Editor);
    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();
    expect(byTestId('manage-market-user-error')).not.toBeNull();

    byTestId('manage-market-add-user-button')!.click();
    await flushPromises();
    const address = byTestId('manage-market-add-user-input') as HTMLInputElement;
    address.value = EMAIL;
    address.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    byTestId('manage-market-add-user-submit')!.click();
    await flushPromises();

    expect(select().value).toBe(MarketRole.Editor);
    expect(byTestId('manage-market-user-error')).toBeNull();
    wrapper.unmount();
  });

  it('keeps the words of a refusal when adding someone back is refused too', async () => {
    api.put.mockImplementation(async () => {
      served = market([]);
      throw refusing(400, 'User does not have a role in this market');
    });
    api.post.mockRejectedValue(refusing(403, 'You may not add someone to this market'));
    const wrapper = await open();
    await choose(MarketRole.Editor);
    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    byTestId('manage-market-add-user-button')!.click();
    await flushPromises();
    const address = byTestId('manage-market-add-user-input') as HTMLInputElement;
    address.value = EMAIL;
    address.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    byTestId('manage-market-add-user-submit')!.click();
    await flushPromises();

    expect(byTestId('manage-market-add-user-error')!.textContent?.trim()).toBe(
      'You may not add someone to this market',
    );
    expect(byTestId('manage-market-user-error')!.textContent?.trim()).toBe(
      `${EMAIL}: User does not have a role in this market`,
    );
    wrapper.unmount();
  });

  it('gives focus back to the select in a browser that does not focus it on a click', async () => {
    const wrapper = await open();
    const element = select();
    // Safari's way: the value changes and the change fires, with focus left where it was.
    element.value = MarketRole.Editor;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    byTestId('manage-market-role-change-cancel-button')!.click();
    await flushPromises();

    expect(document.activeElement).toBe(element);
    wrapper.unmount();
  });

  it('shows no confirmation on reopening, and leaves nothing pending', async () => {
    const wrapper = await open();
    await choose(MarketRole.Editor);

    await wrapper.setProps({ manageOpen: false });
    await flushPromises();
    expect(byTestId('manage-market-role-change-window')).toBeNull();

    await wrapper.setProps({ manageOpen: true });
    await flushPromises();
    expect(byTestId('manage-market-role-change-window')).toBeNull();
    expect(select().value).toBe(MarketRole.Viewer);
    expect(api.put).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("opens the closed select's list on the arrow keys, rather than stepping into a question", async () => {
    const wrapper = await open();
    const element = select();
    const showPicker = vi.fn();
    Object.defineProperty(element, 'showPicker', { value: showPicker });

    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      element.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(true);
    }
    await flushPromises();
    expect(showPicker).toHaveBeenCalledTimes(6);
    expect(byTestId('manage-market-role-change-window')).toBeNull();

    const alt = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      cancelable: true,
      bubbles: true,
    });
    element.dispatchEvent(alt);
    expect(alt.defaultPrevented).toBe(false);
    wrapper.unmount();
  });
});
