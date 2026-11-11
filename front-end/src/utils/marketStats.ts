/**
 * The Stats tab's figures (E45/F01), in one answer from the server (`GET /markets/:id/stats`,
 * `back-end/market_stats.py`): who applied (`applicantStats.ts`), what they answered
 * (`answerCounts.ts`), the room for those asking (`roomRows.ts`), how full each section is each day
 * (`fillGrid.ts`), who has come each day (`checkInRows.ts`), and the placement and money
 * headlines (the money's card `moneyCard.ts`); the strip's tiles are chosen from the whole answer
 * (`statsHeadlines.ts`). Counted there, so the page
 * reads one small answer however many applied and never downloads the applications to count them.
 */
import { api } from '@/utils/api';
import type { ApplicantCounts } from '@/utils/applicantStats';
import type { AnswerCounts } from '@/utils/answerCounts';
import type { CheckInCounts } from '@/utils/checkInRows';
import type { FillCounts } from '@/utils/fillGrid';
import type { RoomCounts } from '@/utils/roomRows';
import type { Headlines } from '@/utils/statsHeadlines';

export interface MarketStats {
  applicants: ApplicantCounts;
  answers: AnswerCounts;
  /** `null` where the plan has no dates. */
  room: RoomCounts | null;
  /** `null` until an assignment is stored. */
  fill: FillCounts | null;
  /** `null` until the market has reached Market Days. */
  checkIn: CheckInCounts | null;
  headlines: Headlines;
}

export async function fetchMarketStats(marketId: string): Promise<MarketStats> {
  const { data } = await api.get(`/markets/${marketId}/stats`);
  return data as MarketStats;
}
