import { ApplicationStatus } from '@/assets/types/datatypes';
import type { ExportFilters, ExportPreview, ExportStatus } from '@/utils/vendorExport';
import { fixture } from './fixture';

/**
 * The export's server, in the browser, over the fixture: which vendors the filters keep and what
 * each column writes for one, as `back-end/api/vendor_export.py`'s `vendor_shown` and
 * `offered_columns` do, so `ExportVendorsForm` is answered as the product's server would answer it
 * and no endpoint is called. They differ in the order: the fixture's, where the server's is newest
 * first.
 */
type Vendor = (typeof fixture.applications)[number];

const { export: offered, seats } = fixture;

/** `_STATUS_OF`: the review's statuses as the export names them. */
const STATUS_OF: Partial<Record<ApplicationStatus, ExportStatus>> = {
  [ApplicationStatus.Open]: 'open',
  [ApplicationStatus.UnderReview]: 'open',
  [ApplicationStatus.NeedsFollowUp]: 'follow_up',
  [ApplicationStatus.ReviewerApproved]: 'approved',
  [ApplicationStatus.ReviewerRejected]: 'rejected',
};

type Seat = (typeof seats)[number];

/** Each vendor's seats, by date. */
const SEATS = new Map<string, Map<string, Seat>>();
for (const seat of seats) {
  if (!SEATS.has(seat.application)) SEATS.set(seat.application, new Map());
  SEATS.get(seat.application)!.set(seat.date, seat);
}
const seatsOf = (vendor: Vendor) => SEATS.get(vendor.id) ?? new Map<string, Seat>();

/** The fixture seats one vendor at a table, so every seat is a whole one. */
const seatMatches = (seat: Seat, filters: ExportFilters) =>
  (!filters.section || seat.section === filters.section) &&
  (!filters.tier || seat.tier === filters.tier) &&
  filters.size !== 'half';

function placedMatches(vendor: Vendor, filters: ExportFilters): boolean {
  const held = seatsOf(vendor);
  if (filters.placed === 'unplaced') return filters.date ? !held.has(filters.date) : !held.size;
  if (filters.placed !== 'placed') return true;
  const asked = filters.date ? [held.get(filters.date)] : [...held.values()];
  return asked.some((seat) => seat && seatMatches(seat, filters));
}

const answerValues = (answer: string | string[] | undefined) =>
  answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];

/** The vendors the filters keep, in the fixture's order. `reader` is who "Mine" is. */
function vendorsKept(filters: ExportFilters, reader: string): Vendor[] {
  const search = filters.search.trim().toLowerCase();
  return fixture.applications.filter((vendor) => {
    const status = STATUS_OF[vendor.status];
    const { answers, discordState, payment } = vendor.export;
    if (filters.statuses.length && !(status && filters.statuses.includes(status))) return false;
    // The fixture holds no follow-up's owner: the reviewer it is dealt to stands in.
    if (filters.mine && !(status === 'follow_up' && vendor.reviewer === reader)) return false;
    if (!placedMatches(vendor, filters)) return false;
    if (filters.payment && payment.state !== filters.payment) return false;
    if (filters.discord.length && !filters.discord.includes(discordState)) return false;
    for (const [key, options] of Object.entries(filters.answers)) {
      if (options.length && !answerValues(answers[key]).some((value) => options.includes(value))) {
        return false;
      }
    }
    // By the name they chose, as the Vendors page's search finds them (`display_name`).
    const called = vendor.export.preferredName || vendor.name;
    return (
      !search ||
      vendor.email.toLowerCase().includes(search) ||
      called.toLowerCase().includes(search)
    );
  });
}

const labelOf = (list: { id: string; label: string }[], id: string | undefined) =>
  list.find((each) => each.id === id)?.label ?? '';

const ANSWER_PREFIX = 'answer:';
const DATE_PREFIX = 'date:';

/** `as_text_cell`: a cell no spreadsheet runs. */
const asTextCell = (cell: string) => (/^[=+\-@\t\r\n]/.test(cell) ? `'${cell}` : cell);

/** A seat's part on one date. */
function seatCell(vendor: Vendor, columnId: string): string {
  const [date, part] = columnId.slice(DATE_PREFIX.length).split(':') as [string, string];
  const seat = seatsOf(vendor).get(date);
  if (!seat) return '';
  if (part === 'table') return `${seat.section} ${seat.table}`;
  if (part === 'section') return seat.section;
  if (part === 'tier') return seat.tier;
  return 'Full table';
}

/** What one column writes for one vendor. Only an amount, the server's own, goes unescaped. */
function cellOf(vendor: Vendor, columnId: string): string {
  const { payment } = vendor.export;
  const amounts: Record<string, string> = {
    owed: payment.owed,
    paid: payment.paid,
    stillOwed: payment.stillOwed,
  };
  return amounts[columnId] ?? asTextCell(textCell(vendor, columnId));
}

function textCell(vendor: Vendor, columnId: string): string {
  if (columnId.startsWith(ANSWER_PREFIX)) {
    return answerValues(vendor.export.answers[columnId.slice(ANSWER_PREFIX.length)]).join(', ');
  }
  if (columnId.startsWith(DATE_PREFIX)) return seatCell(vendor, columnId);
  const cells: Record<string, string> = {
    name: vendor.name,
    preferredName: vendor.export.preferredName,
    email: vendor.email,
    status: labelOf(offered.statuses, STATUS_OF[vendor.status]),
    datesPlaced: String(seatsOf(vendor).size),
    priceGroup: vendor.export.payment.group,
    discordUsername: vendor.export.discordUsername,
    discordState: labelOf(offered.discordStates, vendor.export.discordState),
    discordInvite: offered.discordInvite,
  };
  return cells[columnId] ?? '';
}

/** The rows the product's preview shows (`PREVIEW_ROWS`). */
const PREVIEW_ROWS = 3;

/** The preview the server would answer with, for `ExportVendorsForm`. `reader` is who "Mine" is. */
export function exportPreview(
  filters: ExportFilters,
  columns: string[],
  reader: string,
): ExportPreview {
  const vendors = vendorsKept(filters, reader);
  return {
    count: vendors.length,
    header: columns.map((id) => labelOf(offered.columns, id)),
    rows: vendors.slice(0, PREVIEW_ROWS).map((vendor) => columns.map((id) => cellOf(vendor, id))),
    offered,
  };
}
