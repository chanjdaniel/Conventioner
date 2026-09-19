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
 *
 * A request that never answered is not a market that does not exist. A phone on a bad connection
 * gets "could not be loaded" and a retry, not "page not found", which would send a visitor away
 * from a page that would have loaded on the next try.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';
import PageNotFound from '@/components/PageNotFound.vue';

const route = useRoute();
const marketSlug = computed(() => String(route.params.marketSlug ?? ''));

const loading = ref(true);
const found = ref(false);
const missing = ref(false);
const marketName = ref('');

async function load() {
  loading.value = true;
  const form = await fetchPublicApplicationForm(marketSlug.value);
  found.value = !form.failed;
  missing.value = form.notFound;
  marketName.value = form.marketName;
  loading.value = false;
}

onMounted(load);
</script>

<template>
  <div class="market-home" data-testid="market-home">
    <div v-if="loading" class="market-home-loading" data-testid="market-home-loading">
      Loading...
    </div>

    <div v-else-if="missing" data-testid="market-home-not-found">
      <PageNotFound />
    </div>

    <div v-else-if="!found" class="market-home-missing" data-testid="market-home-load-failed">
      <h1>This page could not be loaded</h1>
      <p>Check your connection and try again.</p>
      <button type="button" data-testid="market-home-retry-button" @click="load">Try again</button>
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
