<script setup lang="ts">
/**
 * The Discord card on Market Setup (E46/F01/S02).
 *
 * An Admin connects the market to a Discord server through Discord's own approval screen, which
 * adds Conventioner's bot to a server they manage, then picks the role to give each vendor, the
 * form's question that holds their Discord username, and an invite link to share. The role is the
 * organizer's choice (Daniel, T92 Q11), so a role the bot sits below is still offered, marked, with
 * what to change in the server's settings.
 *
 * A manual tool, not part of the plan (Q10, Q19): it is drawn outside the plan's fieldset, so the
 * setup settling on leaving draft leaves it editable, and it stays so until the market is archived.
 * Whether this person may change it is the table's "Connect Discord and give roles" row; anyone it
 * refuses reads the card. Each choice saves as it is made, and the page re-reads the market after
 * (`changed`), never patching it.
 */
import { computed, onMounted, ref } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import { api, getApiErrorMessage } from '@/utils/api';
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

onMounted(() => {
  if (editable.value && connected.value) void loadRoles();
});

const connecting = ref(false);
const connectError = ref<string | null>(null);

async function connect(): Promise<void> {
  connecting.value = true;
  connectError.value = null;
  try {
    const { data } = await api.post(`${base.value}/authorization`);
    window.location.assign(data.url);
  } catch (err) {
    connectError.value = getApiErrorMessage(
      err,
      'Conventioner could not start connecting Discord.',
    );
    connecting.value = false;
  }
}

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
          <p class="discord-server" data-testid="discord-server">
            <span>
              Connected to
              <strong class="discord-server-name">{{
                connection?.guildName || 'a Discord server'
              }}</strong>
            </span>
            <button
              v-if="editable"
              type="button"
              class="btn btn--secondary btn--compact"
              data-testid="discord-disconnect-button"
              @click="confirmingDisconnect = true"
            >
              Disconnect
            </button>
          </p>

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
              <p
                v-else-if="chosenRole && !chosenRole.belowBot"
                class="discord-hint"
                data-testid="discord-role-hint"
              >
                Move the Conventioner role above this one in your server's settings.
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
            <p class="discord-hint">
              Discord asks you to choose a server you manage and adds Conventioner's bot to it.
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
.discord-server,
.discord-confirm {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.5;
}

.discord-server {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* Weight does not inherit here (the design language, Weight). */
.discord-server-name {
  font-weight: 600;
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
