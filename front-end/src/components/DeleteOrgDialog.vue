<script setup lang="ts">
/**
 * Deleting an organization, said out loud first (E20/F04/S01).
 *
 * One of the two irreversible actions in the product, and the one that destroys the MOST: an
 * organization's drafts and archived markets go with it, and an archived market is still publicly
 * served and holds the placement record of a market that actually ran. Deleting one takes a live
 * check-in URL off the air, with no undo.
 *
 * That is a decision the product allows deliberately - raised during charting and reaffirmed on
 * 2026-09-22 - which is exactly why this names what each deletion destroys PER MARKET rather than
 * counting them. A count does not let an organizer tell a forgotten draft from the record of a
 * market that happened.
 *
 * It also states the refusal in the same place: while the organization holds a market that is
 * under way, the deletion is refused and those markets are named, so the organizer can act rather
 * than guess which one is in the way.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { api, getApiErrorMessage } from '@/utils/api';

interface MarketSummary {
  id: string;
  name: string;
  phase: string;
  phaseLabel: string;
  ran: boolean;
  placements: number;
  publicSlug: string | null;
}

const props = defineProps<{ open: boolean; orgId: string; orgName: string }>();
const emit = defineEmits<{ close: []; deleted: [] }>();

const loading = ref(false);
const deleting = ref(false);
const errorMessage = ref('');
const canDelete = ref(false);
const blocking = ref<MarketSummary[]>([]);
const doomed = ref<MarketSummary[]>([]);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    errorMessage.value = '';
    blocking.value = [];
    doomed.value = [];
    canDelete.value = false;
    try {
      const { data } = await api.get(`/organizations/${props.orgId}/deletion-preview`);
      canDelete.value = data?.canDelete === true;
      blocking.value = (data?.blockingMarkets ?? []) as MarketSummary[];
      doomed.value = (data?.marketsToDelete ?? []) as MarketSummary[];
    } catch (err) {
      errorMessage.value = getApiErrorMessage(err, 'Could not read what this would delete.');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

/** What this market loses, in the terms an organizer decides on. */
function consequence(market: MarketSummary): string {
  const parts: string[] = [market.phaseLabel];
  if (market.ran) parts.push('it ran');
  if (market.placements) {
    parts.push(`${market.placements} placement${market.placements === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

const cannotConfirm = computed(() => loading.value || deleting.value || !canDelete.value);

async function confirm() {
  if (cannotConfirm.value) return;
  deleting.value = true;
  errorMessage.value = '';
  try {
    await api.delete(`/organizations/${props.orgId}`);
    emit('deleted');
    emit('close');
  } catch (err: unknown) {
    const body = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
    if (body?.error === 'organization_has_live_markets') {
      // It changed under us: re-state the refusal rather than showing a generic failure.
      canDelete.value = false;
      blocking.value = (body.blockingMarkets ?? []) as MarketSummary[];
      errorMessage.value = String(body.message ?? '');
    } else {
      errorMessage.value = getApiErrorMessage(err, 'Could not delete this organization.');
    }
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="`Delete ${orgName}?`"
    testid="delete-org"
    wide
    destructive
    confirm-label="Delete it all"
    :confirm-disabled="cannotConfirm"
    @close="emit('close')"
    @submit="confirm"
  >
    <p v-if="loading" class="delete-org-loading" data-testid="delete-org-loading">
      Working out what this would destroy...
    </p>

    <template v-else>
      <!-- The refusal, and which markets are in the way. -->
      <section v-if="blocking.length" class="delete-org-block" data-testid="delete-org-blocked">
        <p class="delete-org-lede">
          This cannot be deleted yet. It still holds
          {{ blocking.length }} market{{ blocking.length === 1 ? '' : 's' }} that
          {{ blocking.length === 1 ? 'is' : 'are' }} under way:
        </p>
        <ul class="delete-org-list">
          <li v-for="market in blocking" :key="market.id" data-testid="delete-org-blocking-market">
            <strong>{{ market.name }}</strong>
            <span class="delete-org-detail">{{ market.phaseLabel }}</span>
          </li>
        </ul>
        <p class="delete-org-help">Archive or delete them first, then come back.</p>
      </section>

      <template v-else>
        <p class="delete-org-lede">
          This deletes the organization and everything below it. There is no undo.
        </p>

        <section v-if="doomed.length" class="delete-org-section">
          <h3>{{ doomed.length }} market{{ doomed.length === 1 ? '' : 's' }} will be destroyed</h3>
          <ul class="delete-org-list">
            <li v-for="market in doomed" :key="market.id" data-testid="delete-org-doomed-market">
              <strong>{{ market.name }}</strong>
              <span class="delete-org-detail">{{ consequence(market) }}</span>
              <!-- The URL that stops resolving, named rather than left to be discovered by
                   whoever tries to check in with it. -->
              <span
                v-if="market.publicSlug"
                class="delete-org-url"
                data-testid="delete-org-public-url"
              >
                /{{ market.publicSlug }}/check-in will stop working
              </span>
            </li>
          </ul>
        </section>
        <p v-else class="delete-org-help" data-testid="delete-org-no-markets">
          This organization holds no markets, so nothing else goes with it.
        </p>
      </template>
    </template>

    <p v-if="errorMessage" class="delete-org-error" data-testid="delete-org-error">
      {{ errorMessage }}
    </p>
  </AppDialog>
</template>

<style scoped>
.delete-org-loading,
.delete-org-lede,
.delete-org-help {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.delete-org-help {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.delete-org-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.delete-org-section h3 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.delete-org-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.delete-org-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.delete-org-list li {
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.delete-org-detail {
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
}

.delete-org-url {
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.delete-org-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
