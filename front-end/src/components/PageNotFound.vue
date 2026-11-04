<script setup lang="ts">
/**
 * One "page not found", shown wherever an address leads nowhere.
 *
 * It offers one way onward, deliberately: sign-in, or Markets to an organizer already signed in.
 * This product has no public landing page, and the page is reached two ways: a visitor who mistyped
 * a market link, and a stranger guessing slugs at a market that takes its vendors by CSV import. The
 * second is why the wording stays generic - a gated market and a market that does not exist must
 * read identically, or the 404 becomes an oracle confirming which slugs are real. So the offer
 * depends on the person alone, never on the address.
 *
 * Before this there was no way onward at all.
 */
import { inject, ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const user = inject<Ref<string | null>>('user', ref(null));
</script>

<template>
  <div class="not-found" data-testid="page-not-found">
    <h1>Page not found</h1>
    <p>There is nothing to see at this address. Check the link you were given.</p>
    <button v-if="user" type="button" class="btn btn--primary" @click="router.push('/markets')">
      Markets
    </button>
    <button v-else type="button" class="btn btn--primary" @click="router.push('/login')">
      Sign in
    </button>
  </div>
</template>

<style scoped>
.not-found {
  padding: var(--space-12) var(--space-8);
  color: var(--mm-black);
}

h1 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xl);
  font-weight: 600;
}

p {
  margin: 0 0 var(--space-6);
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}
</style>
