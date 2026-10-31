/**
 * The one helper every screen asks (E39/F01/S02): may this person take this action here, and why
 * not. It reads the answers the market read serves, and offers nothing on an answer it lacks.
 */
import { describe, expect, it } from 'vitest';
import { MarketAction, UNANSWERED, actionRefusal, mayTake } from '@/utils/marketActions';

const SENTENCE = "Only an Admin or the owner may move this market's phase.";

describe('the table, asked from the market', () => {
  const market = { actionRefusals: { 'move-phase': SENTENCE, 'check-in': null } };

  it('allows an action the server answered with null', () => {
    expect(actionRefusal(market, MarketAction.CheckIn)).toBeNull();
    expect(mayTake(market, MarketAction.CheckIn)).toBe(true);
  });

  it("refuses one it refused, in the server's sentence", () => {
    expect(actionRefusal(market, MarketAction.MovePhase)).toBe(SENTENCE);
    expect(mayTake(market, MarketAction.MovePhase)).toBe(false);
  });

  it('refuses one the read carries no answer for, and with no market at all', () => {
    expect(actionRefusal(market, MarketAction.Assign)).toBe(UNANSWERED);
    expect(mayTake({}, MarketAction.CheckIn)).toBe(false);
    expect(mayTake(null, MarketAction.CheckIn)).toBe(false);
    expect(mayTake(undefined, MarketAction.CheckIn)).toBe(false);
  });

  it('refuses when no action is named, as a remedy from an older server names none (T142)', () => {
    expect(actionRefusal(market, null)).toBe(UNANSWERED);
    expect(mayTake(market, undefined)).toBe(false);
  });
});
