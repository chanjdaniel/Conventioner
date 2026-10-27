<script setup lang="ts">
/**
 * The card the account pages stand in: sign in and its tabs, the two password-reset pages and
 * email verification (T73).
 *
 * Each of those pages drew its own card at a fixed `width: 600px`, centred in a column with no
 * gutter. On a 390px phone the page scrolled sideways by 98px, and the card's left edge, where
 * every field and tab starts, sat 112px off-screen, where no scrolling reaches. The door on market day is sometimes a phone, and its attendance page is
 * behind sign-in, so the way in has to fit one too. Owning the card here means the next account
 * page cannot choose a width of its own.
 */
</script>

<template>
  <div class="auth-page">
    <div class="auth-card" data-testid="auth-card">
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* The page gutter is the one thing that keeps the card off a phone's edges. */
.auth-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}

/* The card idiom, extracted: --radius-card and the three-layer shadow. The halo it replaces -
   `0 0 4px 5px` - has no offset, so no light source, and a spread larger than its blur is a ring
   rather than a shadow (E16/F05). 600px at most, as before; a narrower window keeps a 16px gutter
   at each side. */
.auth-card {
  width: 100%;
  max-width: 600px;
  background-color: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: var(--space-8);
}

/* A page title, on the scale's page-title step. With no size of its own it was the browser's 2em,
   28px, between the scale's 26 and 32. */
.auth-card :slotted(h1) {
  font-size: var(--text-xl);
}
</style>
