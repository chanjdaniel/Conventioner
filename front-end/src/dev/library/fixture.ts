import type { ApplicationStatus, MarketRole } from '@/assets/types/datatypes';
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
    status: ApplicationStatus;
    /** The person id of the reviewer it is dealt to. */
    reviewer: string;
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
  seats: { date: string; section: string; table: number; application: string }[];
  /** What the export dialog offers this market: its column groups, columns and answer filters. */
  export: {
    groups: { id: string; label: string }[];
    columns: { id: string; label: string; group: string | null }[];
    questions: { key: string; label: string; options: string[] }[];
  };
}

export const fixture = data as LibraryFixture;
