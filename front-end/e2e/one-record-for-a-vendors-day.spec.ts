import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * One vendor's day is one record, and the database holds it so (T270).
 *
 * A check-in is an upsert keyed by market, vendor and date, and so is what a vendor owes for a
 * day, and an upsert with no unique index behind it inserts twice when two land at once: 16 at
 * once, straight to the stack's database, stored duplicates for most keys. Two organizers at the
 * door, or an organizer and the vendor's own door-code check-in, then left two attendance records,
 * so one Undo took one away and the vendor still read as here, and the history held two arrivals.
 * An Admin setting what a vendor owes as an Editor freed their seat left two owed records, and
 * whichever the server found first won, so the amount set did not stick or the freed line was
 * lost. A unique index on each now refuses the second record, and the write that loses the race
 * lands on the winner's.
 *
 * Proved here because the stack's MongoDB is the one real database CI runs; the back end's own
 * suite runs on fakes, which hold no index.
 */
const ON_THE_DAY = '2099-05-02';
const EDITOR = { email: 'e2e-one-record-editor@example.com', password: 'e2epassword123' };

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

  test("a second owed record for a vendor's day is refused by the database", async ({
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
      set_by_hand: { cents: 0, by: TEST_USER.email, at: new Date().toISOString() },
    });

    const answer = mongoEval(`
      db.amounts_owed.insertOne(${record});
      try { db.amounts_owed.insertOne(${record}); print('stored twice'); }
      catch (e) { print(e.code); }
    `);

    expect(answer).toBe('11000');
    expect(
      count('amounts_owed', {
        market_id: seed.marketId,
        vendor_email: 'alice@example.com',
        date: ON_THE_DAY,
      }),
    ).toBe(1);
  });

  test("an Admin's amount set and an Editor's free of one vendor's day, sent at once, leave one record holding both", async ({
    request,
    playwright,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { marketDate: ON_THE_DAY },
    );
    ensureVerifiedUser(EDITOR.email, EDITOR.password);
    const granted = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/roles`, {
      data: { user_email: EDITOR.email, role: 'editor' },
    });
    expect(granted.ok(), await granted.text()).toBeTruthy();
    const editor = await playwright.request.newContext({
      baseURL: BACKEND_URL,
      ignoreHTTPSErrors: true,
    });
    try {
      const signedIn = await editor.post('/login', { data: EDITOR });
      expect(signedIn.ok(), await signedIn.text()).toBeTruthy();

      const [set, freed] = await Promise.all([
        request.put(
          `${BACKEND_URL}/markets/${seed.marketId}/payments/alice@example.com/owed/${ON_THE_DAY}`,
          { data: { cents: 1000 } },
        ),
        editor.delete(`/markets/${seed.marketId}/placements`, {
          data: { email: 'alice@example.com', date: ON_THE_DAY },
        }),
      ]);

      expect(set.status(), await set.text()).toBe(200);
      expect(freed.status(), await freed.text()).toBe(200);
    } finally {
      await editor.dispose();
    }

    const day = { market_id: seed.marketId, vendor_email: 'alice@example.com', date: ON_THE_DAY };
    expect(count('amounts_owed', day)).toBe(1);
    const held = mongoEval(`
      const record = db.amounts_owed.findOne(${JSON.stringify(day)});
      print(JSON.stringify({ freed: Boolean(record.freed), set: record.set_by_hand?.cents }));
    `);
    expect(JSON.parse(held)).toEqual({ freed: true, set: 1000 });

    // And the Payment tab reads both: the freed table's line, owing the amount the Admin set.
    const account = await request.get(
      `${BACKEND_URL}/markets/${seed.marketId}/payments/alice@example.com`,
    );
    expect(account.ok(), await account.text()).toBeTruthy();
    const line = (await account.json()).lines.find(
      (each: { date: string }) => each.date === ON_THE_DAY,
    );
    expect(line).toMatchObject({ freed: true, owedCents: 1000, owedSetBy: TEST_USER.email });
  });
});
