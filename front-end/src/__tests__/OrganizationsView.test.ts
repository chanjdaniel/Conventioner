// @vitest-environment happy-dom
/**
 * The organizations list follows the newest read of it. Creating an organization reads the list
 * again; when the read the page opened with answered after that one, its older list - without the
 * new organization - replaced it, and the card the organizer had just made vanished.
 */
import { describe, it, expect, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const fetchOrganizations = vi.fn();
vi.mock('@/utils/organizations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/organizations')>()),
  fetchOrganizations: () => fetchOrganizations(),
}));
const post = vi.fn();
vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  api: { post: (...args: unknown[]) => post(...args) },
}));

import { createMemoryHistory, createRouter } from 'vue-router';
import OrganizationsView from '@/views/OrganizationsView.vue';
import AppDialog from '@/components/AppDialog.vue';
import ManageOrgOverlay from '@/views/ManageOrgOverlay.vue';

/** The page at an address, as the app routes it. */
async function at(address: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/organizations', name: 'organizations', component: OrganizationsView }],
  });
  await router.push(address);
  await router.isReady();
  return router;
}

async function mountAt(address = '/organizations') {
  const router = await at(address);
  const wrapper = mount(OrganizationsView, {
    global: { plugins: [router], stubs: { ManageOrgOverlay: true } },
  });
  return { router, wrapper };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const OLD = { id: 'org-1', name: 'Riverside Makers', userRole: 'owner', markets: [] };
const NEW = { id: 'org-2', name: 'Harbour Collective', userRole: 'owner', markets: [] };

/** Create an organization through the dialog, as the organizer does. */
async function create(wrapper: ReturnType<typeof mount>, name: string) {
  await wrapper.get('[data-testid="organizations-create-button"]').trigger('click');
  await flushPromises();
  await wrapper.get('[data-testid="organizations-create-name-input"]').setValue(name);
  wrapper
    .findAllComponents(AppDialog)
    .find((dialog) => dialog.props('testid') === 'organizations-create')!
    .vm.$emit('submit');
  await flushPromises();
}

describe('the organizations list', () => {
  it('keeps the newest read when an older one answers after it', async () => {
    const opening = deferred<unknown[]>();
    const afterCreate = deferred<unknown[]>();
    fetchOrganizations
      .mockReturnValueOnce(opening.promise)
      .mockReturnValueOnce(afterCreate.promise);
    post.mockResolvedValue({ data: {} });

    const { wrapper } = await mountAt();
    await create(wrapper, 'Harbour Collective');
    afterCreate.resolve([OLD, NEW]);
    await flushPromises();
    opening.resolve([OLD]);
    await flushPromises();

    expect(wrapper.text()).toContain('Harbour Collective');
  });

  it('keeps the cards on screen while it reads the list again', async () => {
    fetchOrganizations.mockResolvedValueOnce([OLD]);
    post.mockResolvedValue({ data: {} });
    const { wrapper } = await mountAt();
    await flushPromises();
    expect(wrapper.text()).toContain('Riverside Makers');

    const again = deferred<unknown[]>();
    fetchOrganizations.mockReturnValueOnce(again.promise);
    await create(wrapper, 'Harbour Collective');
    expect(wrapper.text()).toContain('Riverside Makers');
    expect(wrapper.text()).not.toContain('Loading organizations');
    again.resolve([OLD, NEW]);
  });
});

describe('Manage organization from its address', () => {
  const manage = (wrapper: ReturnType<typeof mount>) => wrapper.getComponent(ManageOrgOverlay);

  it('opens for the organization `?manage=` names once the list has loaded', async () => {
    // Manage market's "Manage organization" points here (E38/F12/S01).
    fetchOrganizations.mockResolvedValueOnce([OLD, NEW]);
    const { wrapper } = await mountAt('/organizations?manage=org-2');
    await flushPromises();

    expect(manage(wrapper).props('manageOpen')).toBe(true);
    expect(manage(wrapper).props('org')).toMatchObject({ id: 'org-2' });
  });

  it('drops the key when it closes, so a refresh or Back does not open it again', async () => {
    fetchOrganizations.mockResolvedValue([OLD, NEW]);
    const { router, wrapper } = await mountAt('/organizations?manage=org-2');
    await flushPromises();

    manage(wrapper).vm.$emit('manageClose');
    await flushPromises();

    expect(manage(wrapper).props('manageOpen')).toBe(false);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("drops a key that names none of the reader's organizations, and opens nothing", async () => {
    fetchOrganizations.mockResolvedValueOnce([OLD]);
    const { router, wrapper } = await mountAt('/organizations?manage=org-9');
    await flushPromises();

    expect(manage(wrapper).props('manageOpen')).toBe(false);
    expect(router.currentRoute.value.query).toEqual({});
  });
});
