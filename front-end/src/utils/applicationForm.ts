import type { ApplicationForm, FormField } from '@/assets/types/datatypes';

/** The charset the back-end holds field keys to; they become document keys on every answer. */
export const FIELD_KEY_PATTERN = /^[a-z0-9_]+$/;

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
        return 'Add at least one field to save this form.';
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
    const fields = form?.fields ?? [];

    const seen = new Set<string>();
    for (const field of fields) {
        if (isUntouchedField(field)) continue;

        const key = (field.key ?? '').trim();
        if (!field.label?.trim()) return `Field "${key}" needs a label.`;
        if (!key) return `Field "${field.label}" needs a key.`;
        if (!FIELD_KEY_PATTERN.test(key)) {
            return `Key "${key}" is invalid. Use lowercase letters, numbers, and underscores only.`;
        }
        if (seen.has(key)) return `Duplicate field key "${key}". Keys must be unique.`;
        seen.add(key);

        if (field.type === 'select' || field.type === 'multi_select') {
            if (field.options.length === 0) {
                return `Field "${field.label}" is a ${field.type} and needs at least one option.`;
            }
            const seenOptions = new Set<string>();
            for (const option of field.options) {
                const value = option.trim();
                if (!value) return `Field "${field.label}" has a blank option.`;
                if (seenOptions.has(value)) {
                    return `Field "${field.label}" repeats the option "${value}". Options must be unique.`;
                }
                seenOptions.add(value);
            }
        }
    }
    return null;
}
