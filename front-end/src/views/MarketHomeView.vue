<script setup lang="ts">
/**
 * The public page at a market's bare slug.
 *
 * This route is part of the applicant surface, so it resolves its market the same way its
 * siblings do: by asking the public application-form endpoint, which serves form-intake markets
 * only. A market that takes its vendors by CSV import answers there exactly as a market that does
 * not exist, and this page renders that answer without distinguishing the two - a stranger who
 * guesses a slug learns nothing either way.
 *
 * It used to print the slug straight back out of the URL, which told every visitor that whatever
 * they had typed was a real market.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';

const route = useRoute();
const marketSlug = computed(() => String(route.params.marketSlug ?? ''));

const loading = ref(true);
const found = ref(false);
const marketName = ref('');

onMounted(async () => {
  const form = await fetchPublicApplicationForm(marketSlug.value);
  found.value = !form.failed;
  marketName.value = form.marketName;
  loading.value = false;
});
</script>

<template>
  <div class="market-home" data-testid="market-home">
    <div v-if="loading" class="market-home-loading" data-testid="market-home-loading">
      Loading...
    </div>

    <div v-else-if="!found" class="market-home-missing" data-testid="market-home-not-found">
      <h1>Page not found</h1>
      <p>There is nothing to see at this address.</p>
    </div>

    <template v-else>
      <h1 data-testid="market-home-name">{{ marketName || marketSlug }}</h1>
      <p class="slug-hint">{{ marketSlug }}</p>
    </template>
  </div>
</template>

<style scoped>
.market-home {
  padding: 32px 40px;
  font-family: 'Outfit Regular', sans-serif;
}
h1 {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 600;
  color: var(--mm-black);
}
.slug-hint {
  margin: 0;
  color: #666;
  font-size: 14px;
}
.market-home-loading {
  color: #666;
  font-size: 14px;
}
.market-home-missing p {
  margin: 0;
  color: #666;
  font-size: 14px;
}
</style>
