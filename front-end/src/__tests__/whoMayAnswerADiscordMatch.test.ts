/**
 * Who may answer a possible Discord match, decided where the drawer decides it (E46/F01/S05, T156
 * review note 4): whoever the row "Update a vendor's info" allows, as the update it confirms into
 * asks, and the row "Update info the assignment or price reads" too where a price group reads the
 * username question, as the server asks of confirming and declining alike. Anyone else reads the
 * members offered with no control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import VendorDrawer from '@/components/VendorDrawer.vue';
import {
  ApplicationStatus,
  ApplicationType,
  MarketPhase,
  type Application,
  type Market,
} from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { useVendorDetails } from '@/utils/vendorDetails';
import { EDITOR_ANSWERS, VIEWER_ANSWERS } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const QUESTION = 'discord_username';
const FERN = 'fern@ember.test';

const APPLICATION: Application = {
  id: 'app-fern',
  marketId: 'market-1',
  applicantEmail: FERN,
  formData: { [QUESTION]: 'Fern Studio' },
  status: ApplicationStatus.ReviewerApproved,
  applicationType: ApplicationType.Main,
  updatedAt: '2026-10-01T00:00:00Z',
};

function market(actionRefusals: Record<string, string | null>, priceReads: string[] = []): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Assignment,
    intakeMode: 'form',
    roles: {},
    applicationForm: {
      fields: [
        {
          key: QUESTION,
          label: 'Discord Username',
          type: 'text',
          required: false,
          options: [],
          order: 0,
        },
      ],
    },
    actionRefusals,
    priceReads,
    discord: {
      guildId: '2909267986263572999',
      guildName: 'Riverside Makers',
      usernameQuestion: QUESTION,
      checkedAt: '2026-10-31T12:00:00+00:00',
    },
    discordVendors: [
      {
        applicationId: 'app-fern',
        state: 'not_found',
        shown: 'possible_match',
        possibleMatches: [{ username: 'fern_studio_42', displayName: 'Fern Studio' }],
        moreMatches: 0,
      },
    ],
  } as unknown as Market;
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) =>
    url.endsWith('/applications') ? { data: { applications: [APPLICATION] } } : { data: {} },
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

async function openDrawer(shown: Market) {
  const details = useVendorDetails(ref('market-1'), ref(shown));
  await details.load();
  wrapper = mount(VendorDrawer, {
    props: { market: shown, details, email: FERN, tab: 'application' },
    global: { stubs: { RouterLink: true, Teleport: true } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const testid = (id: string) => `[data-testid="${id}"]`;

describe('who may answer a possible Discord match in the drawer', () => {
  it('an Editor confirms or declines it', async () => {
    const drawer = await openDrawer(market(EDITOR_ANSWERS));

    expect(drawer.findAll(testid('vendors-detail-discord-match'))).toHaveLength(1);
    expect(drawer.find(testid('vendors-detail-discord-confirm')).exists()).toBe(true);
    expect(drawer.find(testid('vendors-detail-discord-decline')).exists()).toBe(true);
  });

  it('a Viewer reads the members offered with no control', async () => {
    const drawer = await openDrawer(market(VIEWER_ANSWERS));

    expect(drawer.findAll(testid('vendors-detail-discord-match'))).toHaveLength(1);
    expect(drawer.find(testid('vendors-detail-discord-confirm')).exists()).toBe(false);
    expect(drawer.find(testid('vendors-detail-discord-decline')).exists()).toBe(false);
  });

  it('an Editor reads them with no control where a price group reads the username question', async () => {
    const drawer = await openDrawer(market(EDITOR_ANSWERS, [QUESTION]));

    expect(drawer.findAll(testid('vendors-detail-discord-match'))).toHaveLength(1);
    expect(drawer.find(testid('vendors-detail-discord-confirm')).exists()).toBe(false);
    expect(drawer.find(testid('vendors-detail-discord-decline')).exists()).toBe(false);
  });

  it('an Admin answers it where a price group reads the username question', async () => {
    const admin = Object.fromEntries(
      Object.keys(EDITOR_ANSWERS).map((action) => [action, null]),
    ) as Record<string, string | null>;
    const drawer = await openDrawer(market(admin, [QUESTION]));

    expect(drawer.find(testid('vendors-detail-discord-confirm')).exists()).toBe(true);
    expect(drawer.find(testid('vendors-detail-discord-decline')).exists()).toBe(true);
    expect(admin[MarketAction.UpdateAssignmentOrPriceInfo]).toBeNull();
  });
});
