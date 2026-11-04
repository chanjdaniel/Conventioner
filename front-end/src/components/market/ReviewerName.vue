<script setup lang="ts">
/**
 * One chosen reviewer, as the Reviewers panel says them in its line and lists them in its dialog:
 * their address, "(you)" on the reader's own, and a chip on one who no longer holds a role on the
 * market, dealt nothing until an Admin removes them (E38/F07/S02).
 */
import { computed } from 'vue';
import type { ReviewTeam } from '@/assets/types/datatypes';
import EmailAddress from '@/components/EmailAddress.vue';
import { CAN_NO_LONGER_REVIEW } from '@/utils/reviewTeam';
import { signedInEmail } from '@/utils/signedIn';

const props = defineProps<{ reviewer: ReviewTeam['reviewers'][number] }>();

const isMe = computed(
  () => props.reviewer.email.toLowerCase() === (signedInEmail() ?? '').toLowerCase(),
);
</script>

<template>
  <EmailAddress :words="reviewer.email" /><span v-if="isMe" class="reviewer-you"> (you)</span
  ><template v-if="!reviewer.able"
    >{{ ' '
    }}<span class="chip chip--attention" data-testid="reviewers-unable">{{
      CAN_NO_LONGER_REVIEW
    }}</span></template
  >
</template>

<style scoped>
.reviewer-you {
  color: var(--mm-text-muted);
}
</style>
