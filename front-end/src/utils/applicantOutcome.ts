/**
 * What an applicant reads once results are published (E36/F05/S02): one of two outcomes, and where
 * they sit. Rejected and approved-without-a-seat read the same, and no reason is ever given; the
 * server decides which is which from the stored seats, and this only words it.
 */
import type { Application, ApplicantSeat } from '@/assets/types/datatypes';
import { tableInWords } from '@/utils/placementChange';
import { getFormattedDate } from '@/utils/utils';

/** The headline, or null before results are published. */
export function outcomeHeadline(application: Pick<Application, 'outcome'>): string | null {
  if (application.outcome === 'has_a_table') return 'You have a table';
  if (application.outcome === 'not_assigned') return 'You did not get assigned';
  return null;
}

/** One seat in words: "Saturday, November 21, 2026: A 3, a whole table, Upper Atrium". */
export function seatLine(seat: ApplicantSeat): string {
  const where = [tableInWords(seat.tableCode, seat.tableChoice), seat.location]
    .filter(Boolean)
    .join(', ');
  return `${getFormattedDate(seat.date)}: ${where}`;
}
