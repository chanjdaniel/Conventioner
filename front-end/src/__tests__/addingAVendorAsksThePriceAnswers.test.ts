/**
 * Adding a vendor asks the price answers (E43/F01/S03): beside the name and the address, every
 * question of the form's own that a price group reads, each required, so a vendor added by hand is
 * priced like any other. A market whose card has no group asks nothing more.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import AddVendorDialog from '@/components/AddVendorDialog.vue';
import type { ApplicationForm } from '@/assets/types/datatypes';

const sent: { url: string; body: unknown }[] = [];

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    api: {
      post: (url: string, body: unknown) => {
        sent.push({ url, body });
        return Promise.resolve({
          data: { application: { applicantEmail: 'walk.in@example.com' } },
        });
      },
    },
  };
});

afterEach(() => {
  sent.length = 0;
});

const STUDENT = 'Current Example College student';
const FORM: ApplicationForm = {
  fields: [
    {
      key: 'business',
      label: 'Business name',
      type: 'text',
      required: true,
      options: [],
      order: 0,
    },
    {
      key: 'affiliation',
      label: 'Are you an Example College student or alumni?',
      type: 'multi_select',
      required: false,
      options: [STUDENT, 'Example College alumni/staff'],
      order: 1,
    },
    {
      key: 'clubs',
      label: 'Which clubs are you a member of?',
      type: 'select',
      required: false,
      options: ['Art Club', 'None'],
      order: 2,
    },
    {
      key: 'volunteer',
      label: 'I volunteered last year',
      type: 'checkbox',
      required: false,
      options: [],
      order: 3,
    },
  ],
} as ApplicationForm;

function dialog(priceReads: string[]) {
  return mount(AddVendorDialog, {
    props: { open: true, marketId: 'market-123', form: FORM, priceReads },
    attachTo: document.body,
  });
}

const testid = (id: string) => `[data-testid="${id}"]`;

async function nameAndAddress(wrapper: ReturnType<typeof dialog>) {
  await wrapper.get(testid('add-vendor-name-input')).setValue('Walk-in Wares');
  await wrapper.get(testid('add-vendor-email-input')).setValue('walk.in@example.com');
}

describe('adding a vendor on a market with price groups', () => {
  it('asks each question a group reads, required, in the form’s order', () => {
    const wrapper = dialog(['clubs', 'affiliation', 'essential_table_choice']);

    const asked = wrapper.findAll('[data-testid^="add-vendor-field-"]');
    expect(asked.map((field) => field.attributes('data-testid'))).toEqual([
      'add-vendor-field-affiliation',
      'add-vendor-field-clubs',
    ]);
    // Required though the form leaves them optional: the price reads them.
    for (const field of asked) expect(field.find('.form-required').exists()).toBe(true);
    expect(wrapper.find(testid('add-vendor-field-business')).exists()).toBe(false);
    wrapper.unmount();
  });

  it('refuses to add until each is answered, then sends them', async () => {
    const wrapper = dialog(['affiliation', 'clubs']);
    const add = wrapper.get(testid('add-vendor-submit-button'));
    await nameAndAddress(wrapper);

    expect(add.attributes('disabled')).toBeDefined();
    await wrapper.get(testid(`add-vendor-input-affiliation-${STUDENT}`)).setValue(true);
    expect(add.attributes('disabled')).toBeDefined();
    await wrapper.get(testid('add-vendor-input-clubs')).setValue('Art Club');
    expect(add.attributes('disabled')).toBeUndefined();

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(sent[0].body).toEqual({
      name: 'Walk-in Wares',
      email: 'walk.in@example.com',
      answers: { affiliation: [STUDENT], clubs: 'Art Club' },
    });
    wrapper.unmount();
  });

  it('takes a checkbox left unticked as its answer', async () => {
    const wrapper = dialog(['volunteer']);
    await nameAndAddress(wrapper);

    expect(wrapper.get(testid('add-vendor-submit-button')).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(sent[0].body).toMatchObject({ answers: { volunteer: false } });
    wrapper.unmount();
  });

  it('asks nothing more on a market whose card has no group', async () => {
    const wrapper = dialog([]);
    await nameAndAddress(wrapper);

    expect(wrapper.find('[data-testid^="add-vendor-field-"]').exists()).toBe(false);
    expect(wrapper.find(testid('add-vendor-price-note')).exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(sent[0].body).toEqual({
      name: 'Walk-in Wares',
      email: 'walk.in@example.com',
      answers: {},
    });
    wrapper.unmount();
  });
});
