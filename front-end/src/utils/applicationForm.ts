import type { ApplicationForm, FormField } from '@/assets/types/datatypes';
import { ESSENTIAL_KEY_PREFIX } from '@/utils/essentialFields';

/**
 * The import's targets that are not questions, with what the import reads each as
 * (`RESERVED_TARGETS` in `back-end/csv_import.py`): a question keyed like one would hold that column.
 */
const RESERVED_IMPORT_KEYS: Record<string, string> = {
  applicant_email: 'who applied',
  submitted_at: 'when they applied',
  sheet_note: "your sheet's note",
};

/** The types a question of the organizer's own can be, as the form builder names them. */
export const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
] as const;

/** The charset the back-end holds field keys to; they become document keys on every answer. */
export const FIELD_KEY_PATTERN = /^[a-z0-9_]+$/;

/**
 * Why a question may not have this key, or null: the save's own refusals of a key alone, for the
 * builder and the amendment's dialog to ask alike, so neither offers a key the save would refuse.
 */
export function fieldKeyError(key: string): string | null {
  if (!FIELD_KEY_PATTERN.test(key)) {
    return `Key "${key}" is invalid. Use lowercase letters, numbers, and underscores only.`;
  }
  if (key.startsWith(ESSENTIAL_KEY_PREFIX)) {
    return `Key "${key}" uses the reserved "${ESSENTIAL_KEY_PREFIX}" prefix. Those keys belong to the essential questions every form already asks.`;
  }
  const meaning = Object.hasOwn(RESERVED_IMPORT_KEYS, key) ? RESERVED_IMPORT_KEYS[key] : null;
  if (meaning) {
    return `Key "${key}" is reserved: the import reads that column as ${meaning}. Choose another key.`;
  }
  return null;
}

/**
 * A field the organizer has added but not filled in at all. It is an unfinished start, not a
 * mistake: it still blocks Save (the back-end requires a label and a key), but it is reported as
 * guidance rather than as a validation failure.
 */
export function isUntouchedField(field: FormField): boolean {
  return !field.label?.trim() && !field.key?.trim();
}

/**
 * Why Save is blocked while the organizer is still starting out. Never leave the Save button
 * disabled without one of these or a {@link applicationFormError} to explain it.
 */
export function applicationFormHint(form: ApplicationForm | null): string | null {
  const fields = form?.fields ?? [];
  if (fields.length === 0) {
    // Not "add at least one field to save this form", which read as "your form is incomplete" -
    // and it is not. A form is its custom fields PLUS the essential questions the plan asks, and
    // either half alone is a form: a market whose form is exactly the essential questions opens
    // applications and receives them. Save writes the custom half, so with none there is simply
    // nothing for it to write.
    return 'This form already asks the essential questions. Add a field to save one of your own.';
  }
  if (fields.some(isUntouchedField)) {
    return 'Give every field a label to save this form.';
  }
  return null;
}

/**
 * Field keys and select options are the primary key and the persisted values of every applicant's
 * answers, so the back-end rejects blank, duplicate, or unaddressable ones. Say so before the
 * organizer clicks Save. Fields they have not started filling in are left to
 * {@link applicationFormHint}.
 */
export function applicationFormError(form: ApplicationForm | null): string | null {
  return applicationFormRefusal(form)?.message ?? null;
}

/** What Save refuses, and for a blank option where it stands: its question's and its own place. */
export interface ApplicationFormRefusal {
  message: string;
  blankOption?: { field: number; option: number };
}

/** {@link applicationFormError}, with the place of a blank option, which the form builder unfolds. */
export function applicationFormRefusal(
  form: ApplicationForm | null,
): ApplicationFormRefusal | null {
  const fields = form?.fields ?? [];

  const seen = new Set<string>();
  for (const [at, field] of fields.entries()) {
    if (isUntouchedField(field)) continue;

    const key = (field.key ?? '').trim();
    const refused = (message: string) => ({ message });
    if (!field.label?.trim()) return refused(`Field "${key}" needs a label.`);
    if (!key) return refused(`Field "${field.label}" needs a key.`);
    const keyRefusal = fieldKeyError(key);
    if (keyRefusal) return refused(keyRefusal);
    if (seen.has(key)) return refused(`Duplicate field key "${key}". Keys must be unique.`);
    seen.add(key);

    if (field.type === 'select' || field.type === 'multi_select') {
      if (field.options.length === 0) {
        return refused(`Field "${field.label}" is a ${field.type} and needs at least one option.`);
      }
      const seenOptions = new Set<string>();
      for (const [option, words] of field.options.entries()) {
        const value = words.trim();
        if (!value) {
          return {
            message: `Field "${field.label}" has a blank option.`,
            blankOption: { field: at, option },
          };
        }
        if (seenOptions.has(value)) {
          return refused(
            `Field "${field.label}" repeats the option "${value}". Options must be unique.`,
          );
        }
        seenOptions.add(value);
      }
    }
  }
  return null;
}

/**
 * Whether an applicant has given a real answer for this field type.
 *
 * "Present in the form data" is not the same as "answered", and the difference is type-shaped:
 * an unticked mandatory consent checkbox arrives as ``false`` and an untouched mandatory
 * multi_select as ``[]``, both of which are non-null, non-empty-string values that a purely
 * null/blank test would wave through. The back end rejects these, so the front end says so first.
 */
export function isFieldAnswered(value: unknown, fieldType: string): boolean {
  if (value === null || value === undefined) return false;
  if (fieldType === 'checkbox') return value === true;
  if (fieldType === 'multi_select') return Array.isArray(value) && value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** The message the back-end would return for a particular unanswered required field. */
export function requiredFieldError(field: FormField): string {
  return `"${field.label}" is required.`;
}

/** Fields in display order, with any gaps in ``order`` renumbered away. */
export function sortedFormFields(fields: FormField[]): FormField[] {
  return [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Whether a one-choice question's answer is among the options it offers now. */
function offered(field: FormField, value: unknown): boolean {
  return field.type !== 'select' || field.options.includes(String(value).trim());
}

/**
 * The answers as the form sends them: an answer to a one-choice question that it no longer offers
 * goes as unanswered, as its control shows it. Sent as it was stored, it was refused with a list of
 * every option on a question the vendor may leave blank; a required one never reaches the send, as
 * {@link formValidationErrors} refuses it first.
 */
export function answersToSend(
  fields: FormField[],
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const sent = { ...formData };
  for (const field of fields) {
    const value = sent[field.key];
    if (isFieldAnswered(value, field.type) && !offered(field, value)) sent[field.key] = '';
  }
  return sent;
}

/**
 * Client-side validation of an applicant's answers against the market's field definitions.
 * Returns an empty record when every required field has been answered.
 *
 * This is a front-end convenience that mirrors the back-end's ``_validated_form_data`` check
 * so the applicant sees what is wrong before the request leaves. A stored answer to a one-choice
 * question that it no longer offers is no answer: its control shows nothing chosen, so nobody could
 * tell why the server then refused it.
 */
export function formValidationErrors(
  fields: FormField[],
  formData: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!field.required) continue;
    const value = formData[field.key];
    if (!isFieldAnswered(value, field.type) || !offered(field, value)) {
      errors[field.key] = requiredFieldError(field);
    }
  }
  return errors;
}
