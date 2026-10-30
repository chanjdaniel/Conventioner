/**
 * A market's card offers Manage to whoever may read the market (E39/F01/S04).
 *
 * Manage market was where roles are given, so the card offered it only to whoever may give Editor
 * and Viewer roles. It now also shows everyone what each role may do on the market and who changed
 * it, read-only but the owner, so a Viewer opens it too; each control inside asks its own row.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

function card(actionRefusals: Record<string, string | null> | undefined) {
  const market = {
    id: 'market-1',
    name: 'Night Market',
    phase: MarketPhase.Review,
    setupObject: { marketDates: [] },
    actionRefusals,
  } as unknown as Market;
  return mount(MarketSummaryCard, { props: { market, showManage: true } });
}

const manage = (wrapper: ReturnType<typeof card>) =>
  wrapper.find('[data-testid="market-card-manage-button"]');

describe("a market's card", () => {
  it('offers Manage to a Viewer, who may read the market', () => {
    expect(manage(card(VIEWER_ANSWERS)).exists()).toBe(true);
  });

  it('does not offer it to someone the market read refuses', () => {
    expect(manage(card(answersRefusing(...Object.values(MarketAction)))).exists()).toBe(false);
    expect(manage(card(undefined)).exists()).toBe(false);
  });
});
