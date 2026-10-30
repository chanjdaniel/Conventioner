/**
 * The Stats tab's figures (E45/F01), in one answer from the server (`GET /markets/:id/stats`,
 * `back-end/market_stats.py`): who applied (`applicantStats.ts`) and what they answered
 * (`answerCounts.ts`). Counted there, so the page reads one small answer however many applied and
 * never downloads the applications to count them.
 */
import { api } from '@/utils/api';
import type { ApplicantCounts } from '@/utils/applicantStats';
import type { AnswerCounts } from '@/utils/answerCounts';

export interface MarketStats {
  applicants: ApplicantCounts;
  answers: AnswerCounts;
}

export async function fetchMarketStats(marketId: string): Promise<MarketStats> {
  const { data } = await api.get(`/markets/${marketId}/stats`);
  return data as MarketStats;
}
