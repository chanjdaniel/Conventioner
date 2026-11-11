/**
 * Auto-Place says when it ran out of time, rather than blaming the room (T272).
 *
 * The server's grid placement stops at its deadline and answers what it placed by then, with
 * `timed_out`; a room that holds fewer than asked answers `timed_out: false`. The organizer can then
 * tell a full room from a slow one.
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

const table = (x: number) => ({
  x_mm: x,
  y_mm: 1500,
  rotation: 0,
  width_mm: 1800,
  height_mm: 900,
  table_type_id: 'type_6ft',
});

beforeEach(() => {
  setActivePinia(createPinia());
  api.post.mockReset();
});

async function placeAnswered(data: object, asked: number) {
  const store = useFloorplanStore();
  store.addTableType({ id: 'type_6ft', name: '6ft', widthMm: 1800, heightMm: 900, maxCapacity: 2 });
  store.setScale(0.05);
  store.setImageSize(400, 300);
  api.post.mockResolvedValue({ data });
  const wrapper = mount(AutoPlaceButton, { props: { marketId: 'market-1' } });

  await wrapper.get('[data-testid="floorplan-auto-place-count"]').setValue(asked);
  await wrapper.get('[data-testid="floorplan-auto-place-btn"]').trigger('click');
  await flushPromises();
  return wrapper.get('[data-testid="floorplan-auto-place-result"]').text();
}

it('says it ran out of time when the server stopped at its deadline', async () => {
  const said = await placeAnswered(
    { placed_tables: [table(1500), table(4500)], timed_out: true },
    5,
  );

  expect(said).toBe('Placed 2 of 5 tables - Auto-Place ran out of time before the rest.');
});

it('says there was no room when the room held fewer in time', async () => {
  const said = await placeAnswered(
    { placed_tables: [table(1500), table(4500)], timed_out: false },
    5,
  );

  expect(said).toBe('Placed 2 of 5 tables - there was no room for the rest.');
});

it('says it placed them all when it did, however long it took', async () => {
  const said = await placeAnswered({ placed_tables: [table(1500)], timed_out: true }, 1);

  expect(said).toBe('Placed 1 table.');
});
