/**
 * Auto-Place names the market it places tables for.
 *
 * The server places tables only for an editor of that market, on a market that is not archived, so
 * the request carries the market the floorplan editor is open on.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import AutoPlaceButton from '@/components/floorplan/AutoPlaceButton.vue';
import { useFloorplanStore } from '@/stores/floorplan';

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

beforeEach(() => {
  setActivePinia(createPinia());
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { placed_tables: [] } });
});

it('sends the market it is placing for', async () => {
  const store = useFloorplanStore();
  store.addTableType({ id: 'type_6ft', name: '6ft', widthMm: 1800, heightMm: 900, maxCapacity: 2 });
  store.setScale(0.05);
  store.setImageSize(400, 300);
  const wrapper = mount(AutoPlaceButton, { props: { marketId: 'market-1' } });

  await wrapper.get('[data-testid="floorplan-auto-place-count"]').setValue(3);
  await wrapper.get('[data-testid="floorplan-auto-place-btn"]').trigger('click');
  await flushPromises();

  expect(api.post).toHaveBeenCalledOnce();
  const [path, body] = api.post.mock.calls[0];
  expect(path).toBe('/floorplans/place-tables');
  expect(body).toMatchObject({ market_id: 'market-1', counts: { type_6ft: 3 } });
});
