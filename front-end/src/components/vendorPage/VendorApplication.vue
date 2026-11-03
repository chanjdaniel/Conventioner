<script setup lang="ts">
/**
 * A signed-in vendor's application, on a market whose vendors apply on its page (ADR 0021).
 *
 * "Apply" while the market takes applications and they have none; their answers, with "Edit"
 * while it still takes them and read-only after; and with none once it no longer does, the
 * sentence that says so. Apply and Edit open the form page until the form moves onto this page.
 */
import { computed } from 'vue';
import { useApplicationStore } from '@/stores/application';
import { applicationAnswerRows, type AnswerRow } from '@/utils/essentialFields';
import { applicationSection, NO_APPLICATION_CLOSED } from '@/utils/vendorPage';
import AnswerValue from '@/components/AnswerValue.vue';

defineProps<{ marketSlug: string }>();

const store = useApplicationStore();

const section = computed(() =>
  store.page ? applicationSection(store.page, store.application) : 'none',
);

/**
 * What the vendor answered, in the order the form asked: the essential questions first, then the
 * organizer's own, rendered by the contract the organizer's review card reads them through too.
 */
const answerRows = computed<AnswerRow[]>(() => {
  const { essential, custom } = applicationAnswerRows(
    store.application?.formData ?? {},
    store.formFields,
  );
  return [...essential, ...custom];
});
</script>

<template>
  <section v-if="section !== 'none'" class="vendor-application">
    <div v-if="section === 'apply'" class="vendor-info" data-testid="vendor-page-info">
      <p>You have not applied to this market yet.</p>
      <RouterLink
        class="btn btn--primary"
        :to="{ name: 'apply', params: { marketSlug } }"
        data-testid="vendor-page-apply-link"
      >
        Apply
      </RouterLink>
    </div>

    <p v-else-if="section === 'closed'" class="vendor-info" data-testid="vendor-page-info">
      {{ NO_APPLICATION_CLOSED }}
    </p>

    <div v-else class="vendor-answers" data-testid="vendor-page-answers">
      <div class="vendor-answers-head">
        <h2>Your answers</h2>
        <RouterLink
          v-if="section === 'edit'"
          class="btn btn--secondary btn--compact"
          :to="{ name: 'apply', params: { marketSlug } }"
          data-testid="vendor-page-edit-link"
        >
          Edit
        </RouterLink>
      </div>
      <p v-if="answerRows.length === 0" class="vendor-no-answers">No answers submitted yet.</p>
      <dl v-else class="answers-list">
        <div
          v-for="row in answerRows"
          :key="row.key"
          class="answer-row"
          :data-testid="`vendor-page-answer-${row.key}`"
        >
          <dt>{{ row.label }}</dt>
          <dd><AnswerValue :value="row.value" /></dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.vendor-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: 0;
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  border-radius: var(--radius-control);
  padding: var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mm-blue);
}

.vendor-info p {
  margin: 0;
}

.vendor-answers-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.vendor-answers-head h2 {
  font-size: var(--text-md);
  color: var(--mm-black);
  margin: 0;
}

.answers-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
}

.answer-row {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.answer-row dt {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mm-text-muted);
  margin-bottom: var(--space-hairline);
}

.answer-row dd {
  font-size: var(--text-sm);
  color: var(--mm-black);
  margin: 0;
}

.vendor-no-answers {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  padding: var(--space-6);
  margin: 0;
  text-align: center;
}
</style>
