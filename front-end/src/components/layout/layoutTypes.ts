/**
 * The market's table types, as the layout page reads and writes them (T257): a type is a name, a
 * width and a depth, and sizes every table of it; the section colours it.
 *
 * Their write is `PUT /markets/:id/table-types`, of the whole list; "Save these types" and "Use
 * saved types" go through the floorplan templates' routes, which know who is asking from the
 * session. A template saved by the beta holds its types in the beta's shape, a height for the
 * depth, which is read here as the depth.
 */
import type { FloorplanObject, TableTypeObject } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { LENGTH_UNITS, lengthMm, type LengthUnit } from './calibration';

/** A type's sides are typed in these, cm first. */
export const SIDE_UNITS: { unit: LengthUnit; label: string }[] = [
  ...LENGTH_UNITS.filter((one) => one.unit === 'cm'),
  ...LENGTH_UNITS.filter((one) => one.unit !== 'cm'),
].map(({ unit, label }) => ({ unit, label }));

/** The shortest and longest side a type may have, as the server holds them. */
export const MIN_SIDE_MM = 100;
export const MAX_SIDE_MM = 20_000;
/** How many types a market keeps. */
export const MAX_TABLE_TYPES = 50;

/** A length in centimetres, to a tenth: "183", "121.9". */
function cm(mm: number): string {
  return String(Math.round(mm) / 10);
}

/** A type's size as the page writes it: "183 x 76 cm". */
export function sizeInWords(type: Pick<TableTypeObject, 'widthMm' | 'depthMm'>): string {
  return `${cm(type.widthMm)} x ${cm(type.depthMm)} cm`;
}

/** A side as it is shown in a field of a unit: 1830 mm is "183" in cm, "1.83" in m. */
export function sideIn(mm: number, unit: LengthUnit): string {
  const factor = LENGTH_UNITS.find((one) => one.unit === unit)!.mm;
  return String(Math.round((mm / factor) * 100) / 100);
}

/** How many of the market's laid-out tables are of each type, by its id. `working` is the layout
 * being edited, counted in place of its stored copy, so a change not saved yet is counted. A beta
 * floorplan, of no location, holds none. */
export function tablesOfEachType(
  floorplans: readonly FloorplanObject[],
  working: FloorplanObject | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  const layouts = floorplans
    .filter((one) => one.locationId && one.id !== working?.id)
    .concat(working ? [working] : []);
  for (const layout of layouts) {
    for (const table of layout.tables) {
      counts.set(table.tableTypeId, (counts.get(table.tableTypeId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Why a type tables use cannot go: "12 tables are Square 4 ft. Change them first." */
export function typeInUse(count: number, name: string): string {
  return count === 1
    ? `1 table is ${name}. Change it first.`
    : `${count.toLocaleString('en')} tables are ${name}. Change them first.`;
}

/** A type as typed in its dialog: the name and each side in a unit. */
export interface TypedType {
  name: string;
  width: string;
  depth: string;
  unit: LengthUnit;
}

/** What a typed type is refused for, by field; empty when it stands. `others` are the market's
 * other types, whose names it may not share. */
export function typedTypeErrors(
  typed: TypedType,
  others: readonly Pick<TableTypeObject, 'name'>[],
): { name?: string; width?: string; depth?: string } {
  const errors: { name?: string; width?: string; depth?: string } = {};
  const name = typed.name.trim();
  if (!name) errors.name = 'Give the type a name.';
  else if (others.some((other) => other.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = `There is a type named ${name} already.`;
  }
  const range = `between ${sideIn(MIN_SIDE_MM, typed.unit)} and ${sideIn(MAX_SIDE_MM, typed.unit)} ${typed.unit}`;
  for (const side of ['width', 'depth'] as const) {
    const mm = lengthMm(typed[side], typed.unit);
    if (mm === null) errors[side] = `Type the ${side} as a number of ${typed.unit}.`;
    else if (Math.round(mm * 10) / 10 < MIN_SIDE_MM || Math.round(mm * 10) / 10 > MAX_SIDE_MM) {
      errors[side] = `The ${side} is ${range}.`;
    }
  }
  return errors;
}

/** A typed type as the market keeps it, its sides in millimetres to a tenth. */
export function typeOf(typed: TypedType, id: string): TableTypeObject {
  const side = (value: string) => Math.round(lengthMm(value, typed.unit)! * 10) / 10;
  return { id, name: typed.name.trim(), widthMm: side(typed.width), depthMm: side(typed.depth) };
}

/** A write of the types not sent, because the layout's own last change did not land first: its
 * message is that save's sentence. */
export class LayoutNotSaved extends Error {}

/** Write the market's types, all of them; answered with the types as stored. */
export async function saveTableTypes(
  marketId: string,
  tableTypes: readonly TableTypeObject[],
): Promise<TableTypeObject[]> {
  const { data } = await api.put(`/markets/${encodeURIComponent(marketId)}/table-types`, {
    tableTypes,
  });
  return data.tableTypes;
}

/** A saved set of types, as "Use saved types" lists it. */
export interface SavedTypes {
  id: string;
  name: string;
  tableTypes: Pick<TableTypeObject, 'name' | 'widthMm' | 'depthMm'>[];
}

/** A template's types as the market keeps them: a beta template's height is the depth, and a type
 * with no name or no size is left out. */
function savedTypesOf(raw: unknown): SavedTypes['tableTypes'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((one) => {
    const type = (one ?? {}) as Record<string, unknown>;
    const name = typeof type.name === 'string' ? type.name.trim() : '';
    const width = Number(type.widthMm);
    const depth = Number(type.depthMm ?? type.heightMm);
    return name && width > 0 && depth > 0 ? [{ name, widthMm: width, depthMm: depth }] : [];
  });
}

function templateOf(raw: unknown): SavedTypes | null {
  const template = (raw ?? {}) as Record<string, unknown>;
  if (typeof template.id !== 'string' || typeof template.name !== 'string') return null;
  return { id: template.id, name: template.name, tableTypes: savedTypesOf(template.tableTypes) };
}

/** The saved types the person may use here: their own, and those of the market's organization,
 * each once, by name. */
export async function listSavedTypes(organizationId?: string | null): Promise<SavedTypes[]> {
  const asks = [api.get('/floorplans/templates')];
  if (organizationId) {
    asks.push(api.get('/floorplans/templates', { params: { organizationId } }));
  }
  const answers = await Promise.all(asks);
  const seen = new Set<string>();
  const templates: SavedTypes[] = [];
  for (const { data } of answers) {
    for (const raw of data?.templates ?? []) {
      const template = templateOf(raw);
      if (!template || seen.has(template.id)) continue;
      seen.add(template.id);
      templates.push(template);
    }
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

/** Save the market's types under a name, in the market's organization, so its people can use
 * them in another market. */
export async function saveTypes(
  name: string,
  tableTypes: readonly TableTypeObject[],
  organizationId?: string | null,
): Promise<void> {
  await api.post('/floorplans/templates', {
    name: name.trim(),
    tableTypes: tableTypes.map(({ id, name, widthMm, depthMm }) => ({
      id,
      name,
      widthMm,
      depthMm,
    })),
    ...(organizationId ? { organizationId } : {}),
  });
}

/** The market's types with a saved set's added: each of its types the market has none of by that
 * name, given a new id. */
export function withSavedTypes(
  market: readonly TableTypeObject[],
  saved: SavedTypes,
  newId: () => string = () => crypto.randomUUID(),
): TableTypeObject[] {
  const names = new Set(market.map((type) => type.name.trim().toLowerCase()));
  const added: TableTypeObject[] = [];
  for (const type of saved.tableTypes) {
    const key = type.name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    added.push({ id: newId(), name: type.name, widthMm: type.widthMm, depthMm: type.depthMm });
  }
  return [...market, ...added];
}
