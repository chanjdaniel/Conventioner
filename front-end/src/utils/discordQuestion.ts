/**
 * The form's question for each vendor's Discord username (E46/F01/S02).
 *
 * The Discord card asks which text question holds the username, and on connecting chooses the
 * first text question whose label names Discord (`_discord_question` in
 * `back-end/api/discord_connection.py`). The form builder offers a ready-made one, which that rule
 * picks up, until the form has such a question.
 */
import type { FormField } from '@/assets/types/datatypes';

export const DISCORD_USERNAME_LABEL = 'Discord username';
const DISCORD_USERNAME_KEY = 'discord_username';

/** Whether a question is one the card would pick up: a text question labelled for Discord. */
export function asksForDiscord(field: Pick<FormField, 'type' | 'label'>): boolean {
  return field.type === 'text' && (field.label ?? '').toLowerCase().includes('discord');
}

/** The ready-made question, last in the form, under a key no question of it has. */
export function discordUsernameQuestion(fields: FormField[]): FormField {
  const taken = new Set(fields.map((field) => field.key));
  let key = DISCORD_USERNAME_KEY;
  for (let n = 2; taken.has(key); n += 1) key = `${DISCORD_USERNAME_KEY}_${n}`;
  return {
    key,
    label: DISCORD_USERNAME_LABEL,
    type: 'text',
    required: false,
    options: [],
    helpText: undefined,
    order: fields.length,
  };
}
