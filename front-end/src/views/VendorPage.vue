<script setup lang="ts">
/**
 * A market's vendor page, at its own address `/<slug>` (ADR 0022).
 *
 * The one page a vendor uses at a market: signed out, it names the market and asks for an email
 * address and then the code sent to it; signed in, it shows where they stand and their
 * application, as the market's state allows. This view is a thin frame; each part is a section
 * component reading the one page state in the application store.
 *
 * It reads the market before drawing anything, so a slug is never printed back before the server
 * has said there is a page here. A market with no vendor page (a draft, one that imports its
 * vendors, a slug that names nothing) answers alike, and reads as any page that is not there. A
 * request that never answered is neither: it says the page could not be loaded, and offers another
 * try, since it would load on the next one.
 *
 * A tab with no sign-in of its own asks the server once whether this device is remembered (ADR
 * 0022) before it draws the sign-in; a remembered vendor is signed straight in, and anything else
 * draws the sign-in as it would have been.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useApplicationStore } from '@/stores/application';
import PageNotFound from '@/components/PageNotFound.vue';
import VendorSignIn from '@/components/vendorPage/VendorSignIn.vue';
import VendorStatus from '@/components/vendorPage/VendorStatus.vue';
import VendorApplication from '@/components/vendorPage/VendorApplication.vue';

const route = useRoute();
const store = useApplicationStore();

const marketSlug = computed(() => String(route.params.marketSlug ?? ''));

type State = 'loading' | 'not-found' | 'failed' | 'ready';
const state = ref<State>('loading');

const signedIn = computed(() => store.isAuthenticatedFor(marketSlug.value));
const vendorName = computed(() => store.application?.vendorName || '');

async function load() {
  state.value = 'loading';
  const read = await store.loadPage(marketSlug.value);
  if (read.notFound) {
    state.value = 'not-found';
    return;
  }
  if (read.failed) {
    state.value = 'failed';
    return;
  }
  if (!signedIn.value) await store.resume(marketSlug.value);
  if (signedIn.value) {
    await loadSignedIn();
    return;
  }
  state.value = 'ready';
}

/** The vendor's own read; an ended sign-in clears itself and the page asks for sign-in again. */
async function loadSignedIn() {
  state.value = 'loading';
  const read = await store.loadVendorRead();
  state.value = read.notFound ? 'not-found' : read.failed ? 'failed' : 'ready';
}

/**
 * Reading their page once the code is right. Watched, not emitted by the sign-in: signing in
 * swaps the sign-in out of the page, and an event from a section already gone is never heard.
 */
watch(signedIn, (now, before) => {
  if (now && !before && state.value === 'ready') void loadSignedIn();
});

const signingOut = ref(false);
const signOutFailed = ref(false);

async function signOut() {
  signingOut.value = true;
  signOutFailed.value = false;
  signOutFailed.value = !(await store.signOut(marketSlug.value));
  signingOut.value = false;
}

onMounted(() => {
  store.error = null;
  void load();
});
</script>

<template>
  <div v-if="state === 'not-found'" data-testid="vendor-page-not-found">
    <PageNotFound />
  </div>
  <div v-else class="vendor-page" data-testid="vendor-page">
    <div v-if="state === 'loading'" class="vendor-page-loading" data-testid="vendor-page-loading">
      Loading...
    </div>

    <div
      v-else-if="state === 'failed'"
      class="vendor-page-failed"
      data-testid="vendor-page-load-failed"
    >
      <h1>This page could not be loaded</h1>
      <p>Check your connection and try again.</p>
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="vendor-page-retry-button"
        @click="load"
      >
        Try again
      </button>
    </div>

    <template v-else>
      <header class="vendor-page-header">
        <h1 data-testid="vendor-page-market-name">{{ store.page?.marketName }}</h1>
        <p v-if="signedIn" class="vendor-page-who" data-testid="vendor-page-signed-in-as">
          Signed in as
          <strong>{{ vendorName || store.applicantEmail }}</strong>
          <!-- Its space inside the interpolation: the template's own whitespace is condensed away. -->
          <template v-if="vendorName">{{ ` (${store.applicantEmail})` }}</template>
        </p>
      </header>

      <VendorSignIn v-if="!signedIn" :market-slug="marketSlug" />

      <template v-else>
        <VendorStatus />
        <VendorApplication />
        <div class="vendor-page-actions">
          <button
            type="button"
            class="btn btn--secondary"
            :disabled="signingOut"
            data-testid="vendor-page-sign-out-btn"
            @click="signOut"
          >
            {{ signingOut ? 'Signing out…' : 'Sign out' }}
          </button>
          <p
            v-if="signOutFailed"
            class="vendor-page-sign-out-error"
            role="alert"
            data-testid="vendor-page-sign-out-error"
          >
            You could not be signed out. Check your connection and try again.
          </p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* A column of its own width, not its content's, so a one-line notice does not narrow it. */
.vendor-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: var(--applicant-max);
  margin: var(--space-8) auto;
  padding: 0 var(--space-4);
}

.vendor-page-header {
  text-align: center;
}

.vendor-page-header h1,
.vendor-page-failed h1 {
  font-family: 'Merge One';
  font-size: var(--text-xl);
  color: var(--mm-black);
  margin: 0;
  overflow-wrap: anywhere;
}

.vendor-page-who {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.vendor-page-loading {
  text-align: center;
  padding: var(--space-12);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.vendor-page-failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.vendor-page-failed p {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.vendor-page-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.vendor-page-sign-out-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-red);
}
</style>
