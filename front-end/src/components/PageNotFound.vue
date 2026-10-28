<script setup lang="ts">
/**
 * One "page not found", shown wherever an address leads nowhere.
 *
 * It offers sign-in and nothing else, deliberately. This product has no public landing page, and
 * the page is reached two ways: a visitor who mistyped a market link, and a stranger guessing
 * slugs at a market that takes its vendors by CSV import. The second is why the wording stays
 * generic - a gated market and a market that does not exist must read identically, or the 404
 * becomes an oracle confirming which slugs are real.
 *
 * Before this there was no way onward at all, and the page still drew the organizer's own
 * navigation drawer behind it.
 */
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="not-found" data-testid="page-not-found">
    <h1>Page not found</h1>
    <p>There is nothing to see at this address. Check the link you were given.</p>
    <button type="button" class="btn btn--primary" @click="router.push('/login')">Sign in</button>
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
