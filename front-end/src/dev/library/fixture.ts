import type { ApplicationStatus, MarketRole } from '@/assets/types/datatypes';
import type { DiscordShown } from '@/utils/discordCheck';
import type { FillCounts } from '@/utils/fillGrid';
import type { RoomCounts } from '@/utils/roomRows';
import type { ExportOffered, ExportPaymentState } from '@/utils/vendorExport';
import data from './fixture.json';

/**
 * The library's data: a market at a real market's sizes, every value synthetic.
 *
 * `fixture.json` is written by `back-end/tests/fixtures/component_library_fixture.py` from the
 * committed synthetic Google Form exports, read with the product's own readers, and is never edited
 * by hand; `back-end/tests/test_component_library_fixture.py` pins its counts. The library computes
 * anything else it shows from this in the browser, and calls no endpoint.
 */
export interface LibraryFixture {
  /** The four-day grid's applicants with a full name and an address: 359. */
  applications: {
    id: string;
    name: string;
    email: string;
    business: string;
    /** Their answer to the question, as the file holds it. */
    sells: string;
    /** When they applied, from the file's Timestamp column as the import stores it: 17 days. */
    submittedAt: string;
    status: ApplicationStatus;
    /** The person id of the reviewer it is dealt to. */
    reviewer: string;
    /** What the export's other columns and filters read of them. */
    export: {
      preferredName: string;
      /** Each question they answered, by its key: a multi-select's options, any other its cell. */
      answers: Record<string, string | string[]>;
      discordUsername: string;
      discordState: DiscordShown;
      /** As a file writes it; `state` is null for nothing owed and none paid. */
      payment: {
        group: string;
        owed: string;
        paid: string;
        stillOwed: string;
        state: ExportPaymentState | null;
      };
    };
  }[];
  /** The people with access to the market: 150. */
  people: { id: string; name: string; email: string; role: MarketRole }[];
  /** The reviewers' person ids: 12. */
  reviewers: string[];
  /** "What kinds of work will you sell?" with every answer kept, each with its count: 228. */
  question: { label: string; options: { label: string; count: number }[] };
  /** Another file's answers the question does not offer, as an import would ask to fix: 43. */
  valuesToFix: string[];
  /** Approved applications seated on each of four dates, 31 tables and 28 in two sections. */
  seats: { date: string; section: string; table: number; tier: string; application: string }[];
  /** The Stats tab's room for the plan of both sections, as the server counts it: the tables asked
   * by the 295 applications not rejected, on each of the four dates and in each of three tiers,
   * Bronze with no table. */
  room: RoomCounts;
  /** The Stats tab's How full for that plan with the seats stored, as the server counts it: every
   * table of both sections held on each of the four dates. */
  fill: FillCounts;
  /** What the export dialog offers this market, as its preview says it, and the invite every row
   * exports. */
  export: ExportOffered & { discordInvite: string };
}

export const fixture = data as LibraryFixture;
