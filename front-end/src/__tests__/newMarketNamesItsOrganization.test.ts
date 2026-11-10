// @vitest-environment happy-dom
/**
 * Create new market names the organization it will belong to, and every label in it is tied to a
 * control (T263): with one organization the dialog says which it is, a line of words with no
 * control, so its "Organization" names nothing by `for`; with several it is a select, named by
 * those words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn() }),
}));

const fetchOrganizations = vi.fn();
vi.mock('@/utils/organizations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/organizations')>()),
  fetchOrganizations: () => fetchOrganizations(),
}));

import NewMarketOverlay from '@/views/NewMarketOverlay.vue';

const ONE = { id: 'org-1', name: 'Example Collective' };
const ANOTHER = { id: 'org-2', name: 'Harbour Makers' };

async function openWith(...organizations: (typeof ONE)[]) {
  fetchOrganizations.mockResolvedValue(organizations);
  const wrapper = mount(NewMarketOverlay, {
    props: { newOpen: true },
    global: { stubs: { RouterLink: true } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** The `for` of every label in the dialog that points at no element on the page. */
function unresolvedLabels() {
  return [...document.querySelectorAll<HTMLLabelElement>('label[for]')]
    .map((label) => label.htmlFor)
    .filter((id) => !document.getElementById(id));
}

/** The words an `aria-labelledby` names an element by. */
function nameOf(element: Element) {
  return (element.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .join(' ');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Create new market, its organization', () => {
  it('with one organization, names it, and no label points at nothing', async () => {
    const wrapper = await openWith(ONE);

    expect(wrapper.get('[data-testid="org-select-only"]').text()).toBe('Example Collective');
    expect(wrapper.find('select').exists()).toBe(false);
    expect(unresolvedLabels()).toEqual([]);
    expect(wrapper.text()).toContain('Organization');
    wrapper.unmount();
  });

  it('with several, offers them in a select named Organization', async () => {
    const wrapper = await openWith(ONE, ANOTHER);

    const select = wrapper.get('[data-testid="org-select-dropdown"]').element;
    expect(nameOf(select)).toBe('Organization');
    expect(unresolvedLabels()).toEqual([]);
    wrapper.unmount();
  });
});
