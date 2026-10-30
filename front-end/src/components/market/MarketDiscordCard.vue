<script setup lang="ts">
/**
 * The Discord card, on the market's Tools tab (E46/F01/S02).
 *
 * An Admin connects the market to a Discord server through Discord's own approval screen, which
 * adds Conventioner's bot to a server they manage, then picks the role to give each vendor, the
 * form's question that holds their Discord username, and an invite link to share. The role is the
 * organizer's choice (Daniel, T92 Q11), so a role the bot sits below is still offered, marked, with
 * what to change in the server's settings.
 *
 * Discord's screen opens in a new tab, so the market stays open here; the page Discord returns to
 * says when the market is connected (`utils/discordConnected.ts`), and the card re-reads it.
 *
 * A manual tool, not part of the plan (Q10, Q19): it stands on the Tools tab, so the setup settling
 * on leaving draft leaves it editable, and it stays so until the market is archived. Whether this
 * person may change it is the table's "Connect Discord and give roles" row; anyone it refuses reads
 * the card. Each choice saves as it is made, and the page re-reads the market after (`changed`),
 * never patching it.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { whenDiscordConnected } from '@/utils/discordConnected';
import { MarketAction, actionRefusal } from '@/utils/marketActions';
import type { DiscordRole, Market } from '@/assets/types/datatypes';

const props = defineProps<{ market: Market }>();
const emit = defineEmits<{ (event: 'changed'): void }>();

const setUp = computed(() => props.market.discordSetUp === true);
const connection = computed(() => props.market.discord ?? null);
const connected = computed(() => Boolean(connection.value?.guildId));
const refusal = computed(() => actionRefusal(props.market, MarketAction.ConnectDiscord));
const editable = computed(() => setUp.value && refusal.value === null);

const base = computed(() => `/markets/${encodeURIComponent(props.market.id)}/discord`);

const textQuestions = computed(() =>
  (props.market.applicationForm?.fields ?? []).filter((field) => field.type === 'text'),
);
const questionLabel = computed(
  () =>
    textQuestions.value.find((field) => field.key === connection.value?.usernameQuestion)?.label ??
    null,
);

const roles = ref<DiscordRole[]>([]);
const rolesError = ref<string | null>(null);
/** The roles offered: the server's, and the stored one if the server no longer lists it. */
const roleOptions = computed<DiscordRole[]>(() => {
  const stored = connection.value?.roleId;
  if (!stored || roles.value.some((role) => role.id === stored)) return roles.value;
  return [
    ...roles.value,
    { id: stored, name: connection.value?.roleName ?? stored, belowBot: true },
  ];
});
const chosenRole = computed(
  () => roleOptions.value.find((role) => role.id === connection.value?.roleId) ?? null,
);

async function loadRoles(): Promise<void> {
  rolesError.value = null;
  try {
    const { data } = await api.get(`${base.value}/roles`);
    roles.value = data.roles ?? [];
  } catch (err) {
    rolesError.value = getApiErrorMessage(err, "Conventioner could not read this server's roles.");
  }
}

/** The chosen role sits at or above the bot's own, so giving it would fail until it is moved. */
const roleAboveBot = computed(() => (chosenRole.value ? !chosenRole.value.belowBot : false));
const checking = ref(false);
/** The organizer checked again after moving the role, and the bot is still below it. */
const stillAbove = ref(false);

/** Read the server's roles again, once the organizer has moved Conventioner's role in Discord. */
async function checkAgain(): Promise<void> {
  checking.value = true;
  stillAbove.value = false;
  await loadRoles();
  checking.value = false;
  stillAbove.value = !rolesError.value && roleAboveBot.value;
}

/** On opening connected, and once the tab Discord returned to has connected the market. */
watch(
  () => editable.value && connected.value,
  (readable) => {
    if (readable) void loadRoles();
  },
  { immediate: true },
);

const connecting = ref(false);
/** Discord's screen is open in its own tab, and the market is not connected yet. */
const waiting = ref(false);
const connectError = ref<string | null>(null);

async function connect(): Promise<void> {
  connectError.value = null;
  // Opened in the click itself, before the request: a tab opened after it is taken for a pop-up.
  const tab = window.open('', '_blank');
  if (!tab) {
    connectError.value =
      'Your browser blocked the tab for Discord. Allow pop-ups for Conventioner, then connect again.';
    return;
  }
  // Discord's page gets no hold on this one: the effect of `noopener`, which `window.open` cannot be
  // given here, since a tab opened with it hands back nothing to send on.
  tab.opener = null;
  connecting.value = true;
  try {
    const { data } = await api.post(`${base.value}/authorization`);
    tab.location.href = data.url;
    waiting.value = true;
  } catch (err) {
    tab.close();
    connectError.value = getApiErrorMessage(
      err,
      'Conventioner could not start connecting Discord.',
    );
  } finally {
    connecting.value = false;
  }
}

const stopListening = whenDiscordConnected(
  () => props.market.id,
  () => emit('changed'),
);
onUnmounted(stopListening);

const saveError = ref<string | null>(null);

async function save(choice: Record<string, string | null>): Promise<void> {
  saveError.value = null;
  try {
    await api.put(base.value, choice);
    emit('changed');
  } catch (err) {
    saveError.value = getApiErrorMessage(err, 'This choice was not saved.');
  }
}

function onRole(event: Event): void {
  stillAbove.value = false;
  void save({ roleId: (event.target as HTMLSelectElement).value || null });
}

function onQuestion(event: Event): void {
  void save({ usernameQuestion: (event.target as HTMLSelectElement).value || null });
}

function onInvite(event: Event): void {
  void save({ inviteLink: (event.target as HTMLInputElement).value.trim() });
}

const confirmingDisconnect = ref(false);
const disconnectError = ref<string | null>(null);

async function disconnect(): Promise<void> {
  disconnectError.value = null;
  try {
    await api.delete(`${base.value}/connection`);
    confirmingDisconnect.value = false;
    emit('changed');
  } catch (err) {
    disconnectError.value = getApiErrorMessage(err, 'Discord was not disconnected.');
  }
}
</script>

<template>
  <ElementSettingContainer class="card-grid__wide" data-testid="plan-card-discord">
    <template #setting-title>
      <h2>Discord</h2>
    </template>
    <template #setting-content>
      <div class="discord-card">
        <p class="discord-lead">
          Give this market's vendors a role in your Discord server. You can change this card in
          every phase, until the market is archived.
        </p>

        <p v-if="!setUp" class="note" data-testid="discord-not-set-up">
          Discord is not set up on this Conventioner.
        </p>

        <template v-if="connected">
          <div class="discord-server" data-testid="discord-server">
            <p class="discord-server-label">
              <span class="field-label">Connected to</span>
              <strong class="discord-server-name" data-testid="discord-server-name">{{
                connection?.guildName || 'a Discord server'
              }}</strong>
            </p>
            <button
              v-if="editable"
              type="button"
              class="btn btn--secondary btn--compact"
              data-testid="discord-disconnect-button"
              @click="confirmingDisconnect = true"
            >
              Disconnect
            </button>
          </div>

          <div v-if="editable" class="discord-choices">
            <div class="discord-choice">
              <label class="field-label" for="discord-role">Role to give</label>
              <select
                id="discord-role"
                class="field field--select"
                :value="connection?.roleId ?? ''"
                data-testid="discord-role-select"
                @change="onRole"
              >
                <option value="">Choose a role</option>
                <option v-for="role in roleOptions" :key="role.id" :value="role.id">
                  {{ role.belowBot ? role.name : `${role.name} (above Conventioner's role)` }}
                </option>
              </select>
              <p v-if="rolesError" class="discord-error" data-testid="discord-roles-error">
                {{ rolesError }}
              </p>
            </div>

            <div class="discord-choice">
              <label class="field-label" for="discord-question">Username question</label>
              <select
                id="discord-question"
                class="field field--select"
                :value="questionLabel ? connection?.usernameQuestion : ''"
                data-testid="discord-question-select"
                @change="onQuestion"
              >
                <option value="">Choose a question</option>
                <option v-for="field in textQuestions" :key="field.key" :value="field.key">
                  {{ field.label }}
                </option>
              </select>
              <p v-if="!textQuestions.length" class="discord-hint">
                The form asks no text question yet. Add one that asks for a Discord username.
              </p>
            </div>

            <div class="discord-choice">
              <label class="field-label" for="discord-invite">Invite link (optional)</label>
              <input
                id="discord-invite"
                class="field"
                type="url"
                :value="connection?.inviteLink ?? ''"
                placeholder="https://discord.gg/abc123"
                data-testid="discord-invite-input"
                @change="onInvite"
              />
            </div>

            <!-- A warning, not a hint (Daniel's walk): until it is moved, giving the role fails. -->
            <div
              v-if="roleAboveBot && chosenRole"
              class="discord-warning"
              role="alert"
              data-testid="discord-role-warning"
            >
              <p class="discord-warning-title">
                <strong>Conventioner cannot give {{ chosenRole.name }} yet</strong>
              </p>
              <p class="discord-warning-text">
                Its role in your server is below {{ chosenRole.name }}, and Discord lets a bot give
                only roles below its own.
              </p>
              <ol class="discord-warning-steps">
                <li>In Discord, open Server Settings, then Roles.</li>
                <li>Drag the Conventioner role above {{ chosenRole.name }}, and save.</li>
                <li>Check again here.</li>
              </ol>
              <div class="discord-warning-check">
                <button
                  type="button"
                  class="btn btn--secondary btn--compact"
                  :disabled="checking"
                  data-testid="discord-role-check-again"
                  @click="checkAgain"
                >
                  {{ checking ? 'Checking…' : 'Check again' }}
                </button>
                <span
                  v-if="stillAbove"
                  class="discord-warning-text"
                  data-testid="discord-role-still"
                >
                  Checked: the Conventioner role is still below {{ chosenRole.name }}.
                </span>
              </div>
            </div>

            <p v-if="saveError" class="discord-error" data-testid="discord-save-error">
              {{ saveError }}
            </p>
          </div>

          <dl v-else class="discord-read">
            <dt>Role to give</dt>
            <dd data-testid="discord-role-value">{{ connection?.roleName || 'Not chosen' }}</dd>
            <dt>Username question</dt>
            <dd data-testid="discord-question-value">{{ questionLabel || 'Not chosen' }}</dd>
            <dt>Invite link</dt>
            <dd data-testid="discord-invite-value">
              <a
                v-if="connection?.inviteLink"
                :href="connection.inviteLink"
                target="_blank"
                rel="noopener noreferrer"
                >{{ connection.inviteLink }}</a
              >
              <template v-else>None</template>
            </dd>
          </dl>
        </template>

        <template v-else-if="setUp">
          <p v-if="refusal" class="discord-hint" data-testid="discord-refusal">{{ refusal }}</p>
          <div v-else class="discord-connect">
            <button
              type="button"
              class="btn btn--primary"
              :disabled="connecting"
              data-testid="discord-connect-button"
              @click="connect"
            >
              Connect Discord
            </button>
            <p
              v-if="waiting"
              class="discord-hint"
              role="status"
              data-testid="discord-connect-waiting"
            >
              Discord opened in a new tab. Choose a server there, and this card shows it.
            </p>
            <p v-else class="discord-hint">
              Discord asks you to choose a server you manage, in a new tab, and adds Conventioner's
              bot to it.
            </p>
            <p v-if="connectError" class="discord-error" data-testid="discord-connect-error">
              {{ connectError }}
            </p>
          </div>
        </template>
      </div>

      <AppDialog
        :open="confirmingDisconnect"
        :title="`Disconnect ${connection?.guildName || 'Discord'}?`"
        testid="discord-disconnect"
        destructive
        confirm-label="Disconnect"
        :error="disconnectError ?? undefined"
        @close="confirmingDisconnect = false"
        @submit="disconnect"
      >
        <p class="discord-confirm">
          This market forgets the server, its role and its invite link. Conventioner's bot stays in
          the server until you remove it there.
        </p>
      </AppDialog>
    </template>
  </ElementSettingContainer>
</template>

<style scoped>
.discord-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.discord-lead,
.discord-server-label,
.discord-confirm {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.5;
}

/* The server's name on a line of its own under its label, so it reads as the answer rather than
   the end of a sentence (Daniel's walk: "Connected to <server>" read cramped). Disconnect stands
   level with the name; on a narrow card it wraps under it. */
.discord-server {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.discord-server-label {
  min-width: 0;
}

/* Weight does not inherit here (the design language, Weight). */
.discord-server-name {
  display: block;
  font-size: var(--text-md);
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* The attention tone of the chips (`--mm-chip-attention` inside `--mm-yellow`), as a block: a step
   the organizer must take in Discord before the role can be given. */
.discord-warning {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  color: var(--mm-black);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.discord-warning p,
.discord-warning-steps {
  margin: 0;
}

.discord-warning-title strong {
  font-weight: 600;
  color: var(--mm-text-yellow-on-tint);
}

.discord-warning-steps {
  padding-left: var(--space-6);
}

.discord-warning-check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.discord-choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}

.discord-choices > .discord-error {
  grid-column: 1 / -1;
}

.discord-connect {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.discord-hint,
.discord-error {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.discord-error {
  color: var(--mm-text-yellow);
}

.discord-read {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
}

.discord-read dt {
  color: var(--mm-text-muted);
}

.discord-read dd {
  margin: 0;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.discord-read a {
  color: var(--mm-text-link);
  text-decoration: underline;
}
</style>
