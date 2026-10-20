import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { mongoEval } from './helpers/mongo';

/**
 * Vendor notes (E31/F04; map `what-to-show-and-when` ticket 03).
 *
 * A vendor may need something beyond their table, and the organizer needs somewhere to record what
 * they know and did about it. Two kinds, never one field with two authors: the vendor's request,
 * and the organizer's note. Both are in front of whoever looks at that vendor, the door included.
 */
function askFor(marketId: string, email: string, request: string): void {
  mongoEval(
    `db.applications.updateOne({market_id:${JSON.stringify(marketId)}, applicant_email:${JSON.stringify(email)}}, {$set:{"form_data.essential_request": ${JSON.stringify(request)}}})`,
  );
}

test('a request and a note follow the vendor from Vendors to the door, where it is handled', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  askFor(seed.marketId, 'alice@example.com', 'An extra chair, please');

  // On Vendors, the panel opens on both kinds, each under its own label.
  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?vendor=alice%40example.com`);
  const notes = page.getByTestId('vendors-detail-notes');
  await expect(notes.getByTestId('vendors-detail-notes-request')).toContainText(
    'An extra chair, please',
  );
  await notes.getByTestId('vendors-detail-notes-note-input').fill('Chair set aside by the door');
  await notes.getByTestId('vendors-detail-notes-note-save').click();
  await expect(notes).toContainText(TEST_USER.email);

  // At the door, only the vendor with something noted carries the marker.
  const attendance = new AttendanceStatusPage(page);
  await attendance.goto(seed.marketId);
  const alice = page.getByTestId('attendance-notes-alice@example.com');
  await expect(alice.getByTestId('attendance-notes-alice@example.com-request-marker')).toHaveText(
    'Request',
  );
  await expect(page.getByTestId('attendance-notes-bob@example.com')).toHaveCount(0);

  await alice.getByTestId('attendance-notes-alice@example.com-summary').click();
  await expect(alice.getByTestId('attendance-notes-alice@example.com-note-input')).toHaveValue(
    'Chair set aside by the door',
  );
  await alice.getByTestId('attendance-notes-alice@example.com-handled').check();
  await expect(alice.getByTestId('attendance-notes-alice@example.com-request-marker')).toHaveText(
    'Request handled',
  );
});
