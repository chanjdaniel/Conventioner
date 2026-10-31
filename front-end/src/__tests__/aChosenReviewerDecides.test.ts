/**
 * A chosen reviewer, a Viewer included, decides (E38/F07/S03).
 *
 * Being chosen lets a Viewer give verdicts and mark follow-ups, but not write the vendor's notes:
 * that is its own row. Marking a follow-up offers "Their notes" only to someone that row lets
 * write them, so a chosen Viewer marks it without the box, rather than being refused on the note
 * after confirming.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { useVerdictActions } from '@/utils/verdictActions';
import FollowUpDialog from '@/components/application/FollowUpDialog.vue';

const reviewApplication = vi.fn();
const saveVendorNote = vi.fn();

vi.mock('@/utils/applicantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/applicantApi')>()),
  reviewApplication: (...args: unknown[]) => reviewApplication(...args),
}));
vi.mock('@/utils/vendorNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/vendorNotes')>()),
  saveVendorNote: (...args: unknown[]) => saveVendorNote(...args),
}));

const NOTES_REFUSED =
  "Only an Editor, an Admin or the owner may write notes on this market's vendors.";

const APP = {
  id: 'app-1',
  applicantEmail: 'nadia@ember.test',
  status: ApplicationStatus.Open,
  submittedAt: '2026-10-01',
  formData: {},
} as unknown as Application;

function mountDialog(writesNotes: boolean) {
  return mount(FollowUpDialog, {
    props: {
      open: true,
      applicantEmail: APP.applicantEmail,
      people: ['ana@example.com', 'sam@market.test'],
      me: 'ana@example.com',
      note: 'Asked about power',
      writesNotes,
    },
    global: { stubs: { teleport: true } },
  });
}

describe('the follow-up dialog', () => {
  it('leaves out "Their notes" for someone who may not write them', async () => {
    const wrapper = mountDialog(false);

    expect(wrapper.find('[data-testid="follow-up-note"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Their notes');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({ ownerEmail: 'ana@example.com' });
  });

  it('offers them, opened on the note there, to someone who may', () => {
    const wrapper = mountDialog(true);

    expect(
      (wrapper.get('[data-testid="follow-up-note"]').element as HTMLTextAreaElement).value,
    ).toBe('Asked about power');
  });
});

describe('marking a follow-up', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    reviewApplication.mockReset().mockResolvedValue({
      ...APP,
      status: ApplicationStatus.NeedsFollowUp,
    });
    saveVendorNote.mockReset().mockResolvedValue(undefined);
  });

  function actions(refusals: Record<string, string | null>) {
    const market = ref({
      id: 'market-1',
      actionRefusals: refusals,
      peopleOnMarket: ['ana@example.com'],
    } as unknown as Market);
    return useVerdictActions(market, ref([APP]));
  }

  it('says whether this person writes the vendor’s notes, as the table answers', () => {
    expect(actions({ [MarketAction.WriteVendorNotes]: NOTES_REFUSED }).writesNotes.value).toBe(
      false,
    );
    expect(actions({ [MarketAction.WriteVendorNotes]: null }).writesNotes.value).toBe(true);
  });

  it('marks it without writing a note when the dialog offered none', async () => {
    const outcome = await actions({
      [MarketAction.WriteVendorNotes]: NOTES_REFUSED,
    }).markFollowUp(APP, { ownerEmail: 'sam@market.test' }, 'Asked about power');

    expect(outcome.kind).toBe('written');
    expect(saveVendorNote).not.toHaveBeenCalled();
    expect(reviewApplication).toHaveBeenCalledWith(
      'market-1',
      APP,
      ApplicationStatus.NeedsFollowUp,
      'sam@market.test',
    );
  });

  it('still writes a changed note first for someone who may', async () => {
    await actions({ [MarketAction.WriteVendorNotes]: null }).markFollowUp(
      APP,
      { ownerEmail: 'ana@example.com', note: 'Needs a portfolio link' },
      '',
    );

    expect(saveVendorNote).toHaveBeenCalledWith(
      'market-1',
      APP.applicantEmail,
      'Needs a portfolio link',
    );
  });
});
