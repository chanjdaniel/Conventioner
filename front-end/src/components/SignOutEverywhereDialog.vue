<script setup lang="ts">
/**
 * Sign out everywhere (T311), opened from the account menu and the phone's sheet: it asks first,
 * since one stray press would sign out the laptop at the door mid-market, then ends every sign-in
 * of the account on the server, this browser's with it (`signOutEverywhere`).
 *
 * Destructive, so it opens on Cancel. Nothing closes it while the request is in flight, so a failure
 * is read here: the person is still signed in, and so is every other device. Done, or answered 401
 * (a session already over, which ends as any request's 401 does), it closes, and the page moves to
 * sign in.
 */
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppDialog from '@/components/AppDialog.vue';
import { signOutEverywhere } from '@/utils/sessionEnded';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const busy = ref(false);
const error = ref('');

watch(
  () => props.open,
  (opened) => {
    if (opened) error.value = '';
  },
);

async function confirm() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const outcome = await signOutEverywhere(router);
  busy.value = false;
  if (outcome === 'failed') {
    error.value = 'Could not sign out everywhere. Try again.';
    return;
  }
  emit('close');
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Sign out everywhere?"
    testid="sign-out-everywhere"
    destructive
    :confirm-label="busy ? 'Signing out…' : 'Sign out everywhere'"
    :confirm-disabled="busy"
    :close-disabled="busy"
    :error="error"
    @close="emit('close')"
    @submit="confirm"
  >
    <p class="sign-out-everywhere-text">
      This signs you out on every device and browser, this one too.
    </p>
  </AppDialog>
</template>

<style scoped>
.sign-out-everywhere-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  /* At a desk's narrow dialog the sentence otherwise leaves "too." alone on its second line. */
  text-wrap: pretty;
}
</style>
