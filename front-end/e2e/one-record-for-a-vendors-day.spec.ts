import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';

/**
 * One vendor's day is one record, and the database holds it so (T270).
 *
 * A check-in is an upsert keyed by market, vendor and date, and an upsert with no unique index
 * behind it inserts twice when two land at once: 16 at once, straight to the stack's database,
 * stored duplicates for most keys. Two organizers at the door, or an organizer and the vendor's
 * own door-code check-in, then left two records, so one Undo took one away and the vendor still
 * read as here, and the history held two arrivals. A unique index now refuses the second record,
 * and the check-in that loses the race lands on the winner's.
 *
 * Proved here because the stack's MongoDB is the one real database CI runs; the back end's own
 * suite runs on fakes, which hold no index.
 */
const ON_THE_DAY = '2099-05-02';

function count(collection: string, filter: Record<string, string>): number {
  return Number(mongoEval(`print(db.${collection}.countDocuments(${JSON.stringify(filter)}))`));
}

test.describe("One record for a vendor's day", () => {
  test("a second attendance record for a vendor's day is refused by the database", async ({
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { marketDate: ON_THE_DAY },
    );
    const record = JSON.stringify({
      market_id: seed.marketId,
      vendor_email: 'alice@example.com',
      date: ON_THE_DAY,
      checked_in_at: new Date().toISOString(),
    });

    const answer = mongoEval(`
      db.attendance.insertOne(${record});
      try { db.attendance.insertOne(${record}); print('stored twice'); }
      catch (e) { print(e.code); }
    `);

    expect(answer).toBe('11000');
    expect(
      count('attendance', {
        market_id: seed.marketId,
        vendor_email: 'alice@example.com',
        date: ON_THE_DAY,
      }),
    ).toBe(1);
  });

  test("16 check-ins of one vendor's day sent at once leave one record and one arrival", async ({
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { marketDate: ON_THE_DAY },
    );

    const answers = await Promise.all(
      Array.from({ length: 16 }, () =>
        request.post(`${BACKEND_URL}/markets/${seed.marketId}/attendance`, {
          data: { vendorEmail: 'bob@example.com', date: ON_THE_DAY },
        }),
      ),
    );

    for (const answer of answers) {
      expect(answer.status(), await answer.text()).toBe(200);
    }
    expect(
      count('attendance', {
        market_id: seed.marketId,
        vendor_email: 'bob@example.com',
        date: ON_THE_DAY,
      }),
    ).toBe(1);
    expect(count('history', { market_id: seed.marketId, kind: 'checked_in' })).toBe(1);

    // So one Undo takes the check-in away.
    const undone = await request.delete(`${BACKEND_URL}/markets/${seed.marketId}/attendance`, {
      data: { vendorEmail: 'bob@example.com', date: ON_THE_DAY },
    });
    expect(undone.status(), await undone.text()).toBe(200);
    expect(count('attendance', { market_id: seed.marketId, vendor_email: 'bob@example.com' })).toBe(
      0,
    );
  });
});
