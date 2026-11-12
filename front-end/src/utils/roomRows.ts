/**
 * The Stats tab's Room (T201): whether the plan has room for those asking. The server counts it
 * (`count_room` in `back-end/market_stats.py`): per market date the tables asked and the plan's
 * tables, and per tier the same summed over the dates, in table-days; `tiers` is empty in a plan of
 * fewer than two tiers. Asked is a ceiling, as the dates are: a half table counts 0.5, anything else
 * 1, on every date the vendor is available, and toward every tier they accept that date.
 *
 * Here those counts become the section's cards, each a row per day or tier drawn as a `MeterBar`
 * with its mark at the tables, every row of a card on one scale, the card's largest asked or tables,
 * so the rows compare. Before anyone applies a row reads its tables alone and draws no bar, so a
 * draft already shows its capacity.
 */
import { getFormattedDate } from '@/utils/utils';

export interface RoomDay {
  /** The plan's own spelling of the date. */
  date: string;
  asked: number;
  tables: number;
}

export interface RoomTier {
  tier: string;
  asked: number;
  /** The tier's table-days: its sections' tables over every market date. */
  tables: number;
}

/** The server's `room`; `null` where the plan has no dates. */
export interface RoomCounts {
  dates: RoomDay[];
  tiers: RoomTier[];
}

export interface RoomRow {
  key: string;
  label: string;
  /** The row's text: "42 asking, 30 tables", or "30 tables" before anyone applies. */
  words: string;
  /** Asked, drawn as the bar; `null` before anyone applies, so no bar. */
  asked: number | null;
  /** The tables, drawn as the bar's mark. */
  tables: number;
  /** More asked than the tables hold. */
  over: boolean;
}

export interface RoomCard {
  id: 'days' | 'tiers';
  title: string;
  rows: RoomRow[];
  /** What every bar of the card is drawn against: its largest asked or tables. */
  scale: number;
  /** What the figures mean, said under the rows once anything is asked; empty before. */
  note: string;
}

/** The room's cards: the days, and the tiers where the plan has two or more; none without dates. */
export function roomCards(room: RoomCounts | null, anyoneApplied: boolean): RoomCard[] {
  if (!room) return [];
  const cards = [
    card(
      'days',
      'Tables asked each day',
      room.dates.map((day) => ({
        key: day.date,
        label: getFormattedDate(day.date) ?? day.date,
        ...day,
      })),
      'table',
      'A ceiling: someone available three days who wants at most two counts on all three.',
      anyoneApplied,
    ),
  ];
  if (room.tiers.length) {
    cards.push(
      card(
        'tiers',
        'Table-days asked each tier',
        room.tiers.map((tier) => ({ key: tier.tier, label: tier.tier, ...tier })),
        'table-day',
        'A vendor who accepts two tiers on a day counts in both.',
        anyoneApplied,
      ),
    );
  }
  return cards;
}

interface Counted {
  key: string;
  label: string;
  asked: number;
  tables: number;
}

function card(
  id: RoomCard['id'],
  title: string,
  counted: Counted[],
  unit: string,
  note: string,
  anyoneApplied: boolean,
): RoomCard {
  const units = (n: number) => `${figure(n)} ${n === 1 ? unit : `${unit}s`}`;
  return {
    id,
    title,
    rows: counted.map(({ key, label, asked, tables }) => ({
      key,
      label,
      words: anyoneApplied ? `${figure(asked)} asking, ${units(tables)}` : units(tables),
      asked: anyoneApplied ? asked : null,
      tables,
      over: anyoneApplied && asked > tables,
    })),
    scale: Math.max(
      0,
      ...counted.map((row) => Math.max(row.tables, anyoneApplied ? row.asked : 0)),
    ),
    note: anyoneApplied ? note : '',
  };
}

/** A count of tables, a half included: "12.5", "1,250". */
export function figure(n: number): string {
  return n.toLocaleString('en-US');
}
