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
 * says how connecting ended (`utils/discordConnected.ts`), and the card re-reads the market, or
 * stops saying Discord is open, as it does when this tab is shown again.
 *
 * A manual tool, not part of the plan (Q10, Q19): it stands on the Tools tab, so the setup settling
 * on leaving draft leaves it editable, and it stays so until the market is archived. Whether this
 * person may change it is the table's "Connect Discord and give roles" row; anyone it refuses reads
 * the card. Each choice saves as it is made, and the page re-reads the market after (`changed`),
 * never patching it.
 *
 * The role and the question are each a `ChoiceField` that writes as it is taken, so a server of 250
 * roles finds one by typing, and typing alone writes nothing. A link in "Giving roles" opens either
 * by the id of its control, a select or a field.
 *
 * The invite link is typed, so the field holds its own draft: a link the server refuses stays there
 * to be finished, under its refusal's words, however often the market is read meanwhile. A stored
 * link read later shows only if nothing unsaved stands in the field; another server or market
 * always replaces it.
 *
 * "Give roles" and "Check Discord" stand on the Vendors page, so once connected the card says so,
 * with what is still missing (`rolesStillNeed`), each linked to where it is done. Only someone who
 * may change the card reads that: it points at controls no one else is offered.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import ChoiceField from '@/components/ChoiceField.vue';
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { whenDiscordEnds } from '@/utils/discordConnected';
import { formTextQuestions } from '@/utils/discordQuestion';
import { rolesStillNeed } from '@/utils/discordRoles';
import { marketPath } from '@/utils/market';
import { MarketAction, actionRefusal } from '@/utils/marketActions';
import type { Ref } from 'vue';
import type { PickerGroup } from '@/components/SearchPicker.vue';
import type { DiscordRole, Market } from '@/assets/types/datatypes';

const props = defineProps<{ market: Market }>();
const emit = defineEmits<{ (event: 'changed'): void }>();

const setUp = computed(() => props.market.discordSetUp === true);
const connection = computed(() => props.market.discord ?? null);
const connected = computed(() => Boolean(connection.value?.guildId));
const refusal = computed(() => actionRefusal(props.market, MarketAction.ConnectDiscord));
const editable = computed(() => setUp.value && refusal.value === null);

const base = computed(() => `/markets/${encodeURIComponent(props.market.id)}/discord`);

const textQuestions = computed(() => formTextQuestions(props.market));
const questionLabel = computed(
  () =>
    textQuestions.value.find((field) => field.key === connection.value?.usernameQuestion)?.label ??
    null,
);
const questionGroups = computed<PickerGroup[]>(() => [
  { options: textQuestions.value.map((field) => ({ value: field.key, label: field.label })) },
]);
const heldQuestion = computed(() =>
  questionLabel.value ? (connection.value?.usernameQuestion ?? '') : '',
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
const roleGroups = computed<PickerGroup[]>(() => [
  {
    options: roleOptions.value.map((role) => ({
      value: role.id,
      label: role.belowBot ? role.name : `${role.name} (above Conventioner's role)`,
    })),
  },
]);
const heldRole = computed(() => connection.value?.roleId ?? '');

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

const stopListening = whenDiscordEnds(() => props.market.id, {
  connected: () => {
    waiting.value = false;
    emit('changed');
  },
  notConnected: () => {
    waiting.value = false;
  },
});
// Back on this tab, Discord's tab is done with, or closed: the market is read again
// (`useOpenMarket`), and the card no longer says Discord is open.
const onVisible = () => {
  if (document.visibilityState === 'visible') waiting.value = false;
};
document.addEventListener('visibilitychange', onVisible);
onUnmounted(() => {
  stopListening();
  document.removeEventListener('visibilitychange', onVisible);
});

const saveError = ref<string | null>(null);
/** Apart from `saveError`: saving a role says nothing of a refused link, still in its field. */
const inviteError = ref<string | null>(null);

const storedInvite = computed(() => connection.value?.inviteLink ?? '');
const inviteDraft = ref(storedInvite.value);
function showStoredInvite(): void {
  inviteDraft.value = storedInvite.value;
  inviteError.value = null;
}
// What was typed was about that server or market, even with no stored link changing.
watch([() => props.market.id, () => connection.value?.guildId], showStoredInvite);
// A re-read never overwrites unsaved work (one market, from the server): the draft follows the
// stored link only while it held the old one, or once it reads the new one, just saved.
watch(storedInvite, (stored, was) => {
  if (inviteDraft.value === was || inviteDraft.value.trim() === stored) showStoredInvite();
});

async function save(
  choice: Record<string, string | null>,
  refusalLine: Ref<string | null>,
): Promise<void> {
  refusalLine.value = null;
  try {
    await api.put(base.value, choice);
    emit('changed');
  } catch (err) {
    refusalLine.value = getApiErrorMessage(err, 'This choice was not saved.');
  }
}

/** A refused choice was never the market's, so its control goes back to what is stored. */
async function write(
  choice: Record<string, string | null>,
  control: Ref<InstanceType<typeof ChoiceField> | null>,
): Promise<void> {
  await save(choice, saveError);
  if (saveError.value) control.value?.showHeld();
}

// A field's list offers the choice it holds too, which a select never fires for: nothing to write.
function onRole(roleId: string): void {
  if (roleId === heldRole.value) return;
  stillAbove.value = false;
  void write({ roleId: roleId || null }, roleField);
}

function onQuestion(usernameQuestion: string): void {
  if (usernameQuestion === heldQuestion.value) return;
  void write({ usernameQuestion: usernameQuestion || null }, questionField);
}

function onInvite(): void {
  void save({ inviteLink: inviteDraft.value.trim() }, inviteError);
}

const stillNeed = computed(() => rolesStillNeed(props.market));
const roleField = ref<InstanceType<typeof ChoiceField> | null>(null);
const questionField = ref<InstanceType<typeof ChoiceField> | null>(null);

/** A choice's control, by what the checklist calls it. */
type CardChoice = 'role' | 'question';
/** The choice whose label is responding to its link, in the link's ink, for a moment. */
const responding = ref<CardChoice | null>(null);
let respondingEnds: ReturnType<typeof setTimeout> | undefined;
const RESPONSE_MS = 1500;

function respond(which: CardChoice): void {
  clearTimeout(respondingEnds);
  responding.value = which;
  respondingEnds = setTimeout(() => {
    responding.value = null;
  }, RESPONSE_MS);
}
onUnmounted(() => clearTimeout(respondingEnds));

/**
 * The click opens the choice's list. Where it cannot, as a select in Safari, with no `showPicker` as
 * of 2026-11, the control still takes the focus, but a field shows no focus at all (the design
 * language), so its label responds instead, or the link would look dead.
 */
function openChoice(which: CardChoice): void {
  const opened = (which === 'role' ? roleField.value : questionField.value)?.open();
  if (!opened) respond(which);
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
        <!-- When it may be changed is said only to someone who may change it. -->
        <p class="discord-lead" data-testid="discord-lead">
          Give this market's vendors a role in your Discord server.<template v-if="editable">
            You can change this card in every phase, until the market is archived.</template
          >
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
            <div class="discord-choice" :data-responding="responding === 'role' || undefined">
              <ChoiceField
                ref="roleField"
                :model-value="heldRole"
                :groups="roleGroups"
                label="Role to give"
                placeholder="Choose a role"
                testid="discord-role-select"
                field-id="discord-role"
                none-row="No role"
                writes
                @update:model-value="onRole"
              />
              <p v-if="rolesError" class="discord-error" data-testid="discord-roles-error">
                {{ rolesError }}
              </p>
            </div>

            <div class="discord-choice" :data-responding="responding === 'question' || undefined">
              <ChoiceField
                ref="questionField"
                :model-value="heldQuestion"
                :groups="questionGroups"
                label="Username question"
                placeholder="Choose a question"
                testid="discord-question-select"
                field-id="discord-question"
                none-row="No question"
                writes
                @update:model-value="onQuestion"
              />
              <p v-if="!textQuestions.length" class="discord-hint">
                The form asks no text question yet. Add one that asks for a Discord username.
              </p>
            </div>

            <div class="discord-choice">
              <label class="field-label" for="discord-invite">Invite link (optional)</label>
              <input
                id="discord-invite"
                v-model="inviteDraft"
                class="field"
                type="url"
                placeholder="https://discord.gg/abc123"
                :aria-invalid="!!inviteError"
                :aria-describedby="inviteError ? 'discord-invite-error' : undefined"
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
            <p
              v-if="inviteError"
              id="discord-invite-error"
              class="discord-error"
              role="alert"
              data-testid="discord-invite-error"
            >
              {{ inviteError }}
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

          <div v-if="editable" class="discord-giving" data-testid="discord-giving">
            <p class="field-label">Giving roles</p>
            <p class="discord-lead">
              Check who is in the server and give roles on the Vendors page.
            </p>
            <template v-if="stillNeed.length">
              <p class="discord-lead discord-giving-still">Still needed:</p>
              <ul class="discord-giving-needs" data-testid="discord-giving-needs">
                <li v-if="stillNeed.includes('role')">
                  <a
                    href="#discord-role"
                    class="link-alone"
                    data-testid="discord-giving-needs-role"
                    @click.prevent="openChoice('role')"
                    >Choose the role to give</a
                  >
                </li>
                <li v-if="stillNeed.includes('question')">
                  <a
                    v-if="textQuestions.length"
                    href="#discord-question"
                    class="link-alone"
                    data-testid="discord-giving-needs-question"
                    @click.prevent="openChoice('question')"
                    >Choose the question that asks their Discord username</a
                  >
                  <RouterLink
                    v-else
                    :to="marketPath(market.id, 'form')"
                    class="link-alone"
                    data-testid="discord-giving-needs-question"
                    >Add a question that asks their Discord username</RouterLink
                  >
                </li>
                <li v-if="stillNeed.includes('assignment')">
                  <RouterLink
                    :to="marketPath(market.id, 'settings')"
                    class="link-alone"
                    data-testid="discord-giving-needs-assignment"
                    >Make the assignment</RouterLink
                  >
                </li>
              </ul>
            </template>
            <RouterLink
              v-else
              :to="marketPath(market.id, 'vendors')"
              class="link-alone"
              data-testid="discord-giving-vendors"
              >Give roles on Vendors</RouterLink
            >
          </div>
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

.discord-choice[data-responding] :deep(.field-label) {
  color: var(--mm-text-link);
}

/* The first column's field stands near the window's left edge, and between phone and desk its list
   is wider than the column: it runs right from the field, not left off the window. */
.discord-choice:first-child
  :deep(.choice-field-picker.search-picker--list-over .search-picker-list) {
  right: auto;
  left: 0;
}

.discord-giving {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.discord-giving-still {
  margin-top: var(--space-2);
}

.discord-giving-needs {
  margin: 0;
  padding-left: var(--space-6);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* On a phone (the Tools tab fits one) the three choices stand one under another, and a list is as
   wide as its field, which is as wide as the card lets anything be. */
@media (width <= 640px) {
  .discord-choices {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-choice :deep(.choice-field-picker.search-picker--list-over .search-picker-list) {
    width: 100%;
  }
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
