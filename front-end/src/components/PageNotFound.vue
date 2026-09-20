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
    <button type="button" class="not-found-action" @click="router.push('/login')">Sign in</button>
  </div>
</template>

<style scoped>
.not-found {
  padding: 48px 40px;
  color: var(--mm-black);
}

h1 {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 600;
}

p {
  margin: 0 0 20px;
  color: var(--mm-text-muted);
  font-size: 14px;
}

.not-found-action {
  height: 38px;
  padding: 0 18px;
  border-radius: 6px;
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
  font-size: 14px;
  cursor: pointer;
}
</style>
