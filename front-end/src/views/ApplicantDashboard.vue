<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApplicationStore } from '@/stores/application'
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm'

const route = useRoute()
const router = useRouter()
const store = useApplicationStore()

const marketSlug = computed(() => (route.params.marketSlug as string) || '')
const marketName = ref('')
const loading = ref(true)

onMounted(async () => {
  if (!store.isAuthenticatedFor(marketSlug.value)) {
    router.push({
      name: 'applicant-login',
      params: { marketSlug: marketSlug.value },
    })
    return
  }

  loading.value = true
  const form = await fetchPublicApplicationForm(marketSlug.value)
  marketName.value = form.marketName
  loading.value = false
})

function logout() {
  store.logout()
  router.push({
    name: 'apply',
    params: { marketSlug: marketSlug.value },
  })
}
</script>

<template>
  <div class="dashboard-page" data-testid="applicant-dashboard-page">
    <header class="dash-header">
      <h1>Your Application</h1>
    </header>

    <p class="dash-market" data-testid="applicant-dashboard-market">
      {{ marketName || marketSlug }}
    </p>

    <p class="dash-email" data-testid="applicant-dashboard-email">
      Signed in as <strong>{{ store.applicantEmail }}</strong>
    </p>

    <div v-if="loading" class="dash-loading" data-testid="applicant-dashboard-loading">
      Loading...
    </div>

    <template v-else>
      <div class="dash-info" data-testid="applicant-dashboard-info">
        <p>
          You are signed in to view your application for this market. Your application status and
          form will appear here once the market organizer opens applications.
        </p>
      </div>

      <div class="dash-actions">
        <button
          class="dash-btn dash-btn-secondary"
          @click="logout"
          data-testid="applicant-dashboard-logout-btn"
        >
          Sign Out
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard-page {
  max-width: 640px;
  margin: 40px auto;
  padding: 0 16px;
}

.dash-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.dash-header h1 {
  font-family: 'Merge One';
  font-size: 24px;
  color: var(--mm-black);
  margin: 0;
}

.dash-market {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #666);
  margin: 0 0 8px;
}

.dash-email {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  margin: 0 0 24px;
}

.dash-loading {
  text-align: center;
  padding: 40px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
}

.dash-info {
  background: #e7f1ff;
  border: 1px solid #86b7fe;
  border-radius: 6px;
  padding: 16px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  line-height: 1.5;
  color: #084298;
}

.dash-actions {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-top: 24px;
}

.dash-btn {
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: 14px;
  border: none;
}

.dash-btn-secondary {
  background: transparent;
  color: var(--mm-grey, #666);
  border: 1px solid var(--mm-grey, #ccc);
}
</style>
