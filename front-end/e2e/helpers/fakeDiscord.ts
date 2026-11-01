import { mongoEval } from './mongo';

/**
 * A Discord server the stack's fake answers for (`back-end/discord_fake.py`, T156 review note 6).
 *
 * The stack runs with `DISCORD_FAKE=true` (the worktree overlay, `nm-test.sh` and CI's e2e shards
 * set it), so the back end's bot client asks the fake instead of Discord, and a spec runs the real
 * check, the card's roles and connecting against the server written here. Each spec makes its own
 * server, with an id of its own, so specs running side by side never read each other's members.
 */
export interface FakeDiscordMember {
  id: string;
  username: string;
  /** Discord's display name. */
  globalName?: string;
  /** The member's nickname in this server. */
  nick?: string;
  roles?: string[];
}

export interface FakeDiscordServer {
  guildId: string;
  name: string;
  roles?: { id: string; name: string; position: number }[];
  /** The ids of the bot's own roles in the server. */
  botRoles?: string[];
  members: FakeDiscordMember[];
}

/** A Discord id of its own (a "snowflake": digits), for a server, a role or a member. */
export function fakeDiscordId(): string {
  const now = Date.now().toString().slice(-10);
  const random = Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0');
  return `${now}${random}`;
}

/** Write a server for the fake to answer for, in Discord's own shapes. */
export function seedFakeDiscordServer(server: FakeDiscordServer): void {
  const document = {
    guildId: server.guildId,
    name: server.name,
    roles: (server.roles ?? []).map((role) => ({ ...role, managed: false })),
    botRoles: server.botRoles ?? [],
    members: server.members.map((member) => ({
      user: { id: member.id, username: member.username, global_name: member.globalName ?? null },
      nick: member.nick ?? null,
      roles: member.roles ?? [],
    })),
  };
  mongoEval(`db.fake_discord_servers.insertOne(${JSON.stringify(document)})`);
}

/**
 * Connect a market to a fake server as the card's routes leave it, with the form's Discord
 * username question added and chosen. Connecting through the card is Discord's approval screen,
 * which the fake skips; these specs are about the check, so the connection is written.
 */
export function connectToFakeDiscord(
  marketId: string,
  connection: { guildId: string; guildName: string; roleId?: string; roleName?: string },
  question = { key: 'discord_username', label: 'Discord Username' },
): void {
  const filter = `{ id: ${JSON.stringify(marketId)} }`;
  const field = { ...question, type: 'text', required: false };
  mongoEval(
    `const m = db.markets.findOne(${filter}); ` +
      `const fields = ((m.applicationForm || {}).fields || []).concat([${JSON.stringify(field)}]); ` +
      `db.markets.updateOne(${filter}, { $set: { 'applicationForm.fields': fields, ` +
      `discord: ${JSON.stringify({ ...connection, usernameQuestion: question.key })} } })`,
  );
}
