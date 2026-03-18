<script setup lang="ts">
import { inject, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes';
import { getRoleDisplayName } from '@/utils/permissions';

const setUser: (user: unknown) => void = inject('setUser')!;
const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

const lastMarket = ref<Market | null>(null);

function isValidMarket(obj: unknown): obj is Market {
  if (!obj || typeof obj !== 'object') return false;
  const m = obj as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.name === 'string';
}

onMounted(() => {
  try {
    const stored = localStorage.getItem('market');
    if (!stored) return;
    const parsed = JSON.parse(stored) as unknown;
    if (isValidMarket(parsed)) {
      lastMarket.value = parsed;
    }
  } catch {
    lastMarket.value = null;
  }
});

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const handleLoadLastMarket = () => {
  if (!lastMarket.value) return;
  localStorage.removeItem('market');
  localStorage.setItem('market', JSON.stringify(lastMarket.value));
  router.push('/market-setup');
};

const handleMarkets = () => {
  router.push('/markets');
};

const handleOrganizations = () => {
  router.push('/organizations');
};

const handleSettings = () => {
  console.log('Settings clicked');
};

const handleSignOut = async () => {
  try {
    await fetch(`${hostname}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout failed:', error);
  } finally {
    localStorage.clear();
    setUser(null);
    router.push('/login');
  }
};
</script>

<template>
  <div class="dashboard-view">
    <div class="main-buttons">
      <div class="last-market-section">
        <span class="last-market-label">Previously opened</span>
        <div
          v-if="lastMarket"
          class="last-market-card"
        role="button"
        tabindex="0"
        @click="handleLoadLastMarket"
        @keydown.enter="handleLoadLastMarket"
      >
        <div class="card-header">
          <h3>{{ lastMarket.name }}</h3>
        </div>
        <div class="card-content">
          <div class="info-group">
            <div class="info-row">
              <span class="info-label">Created:</span>
              <span class="info-value">{{ lastMarket.creationDate ? formatDate(lastMarket.creationDate) : '—' }}</span>
            </div>
            <div v-if="lastMarket.organizationName" class="info-row">
              <span class="info-label">Organization:</span>
              <span class="info-value">{{ lastMarket.organizationName }}</span>
            </div>
            <div v-if="lastMarket.userRole" class="info-row">
              <span class="info-label">Your role:</span>
              <span class="info-value role-badge" :class="`role-${lastMarket.userRole.toLowerCase()}`">
                {{ getRoleDisplayName(lastMarket.userRole) }}
              </span>
            </div>
          </div>
        </div>
      </div>
        <div v-else class="last-market-card last-market-card--disabled">
          <span class="disabled-text">Last market not found</span>
        </div>
      </div>

      <div class="button-row">
        <button class="button button-half" @click="handleMarkets">
          <h3>Markets</h3>
        </button>
        <button class="button button-half" @click="handleOrganizations">
          <h3>Organizations</h3>
        </button>
      </div>
    </div>

    <div class="secondary-buttons">
      <button class="button button-small" @click="handleSettings">
        <h4>Settings</h4>
      </button>
      <button class="button button-small" @click="handleSignOut">
        <h4>Sign out</h4>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dashboard-view {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 48px;
  height: 100%;
  width: 100%;
  margin: 0;
}

.main-buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.last-market-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.last-market-label {
  width: 716px;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  font-family: 'Outfit Regular', sans-serif;
}

.button-row {
  display: flex;
  flex-direction: row;
  gap: 24px;
}

.button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  background: var(--mm-black);
  box-shadow: 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s ease-in-out;
}

.button:hover {
  opacity: 0.9;
}

.button-full {
  width: 716px;
  height: 95px;
}

.button-half {
  width: 346px;
  height: 95px;
}

.last-market-card {
  width: 716px;
  padding: 16px 24px;
  border: 1.5px solid var(--mm-grey);
  border-radius: 10px;
  background: white;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.last-market-card:hover {
  border-color: var(--mm-green);
  box-shadow: 0 4px 12px rgba(73, 176, 150, 0.15);
  transform: translateY(-2px);
}

.last-market-card--disabled {
  cursor: default;
  opacity: 0.6;
  background: #f5f5f5;
  justify-content: center;
  min-height: 95px;
}

.last-market-card--disabled:hover {
  border-color: var(--mm-grey);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transform: none;
}

.disabled-text {
  color: #999;
  font-size: 16px;
  font-family: 'Outfit Regular', sans-serif;
}

.last-market-card .card-header {
  flex-shrink: 0;
  min-width: 200px;
}

.last-market-card .card-header h3 {
  margin: 0;
  color: var(--mm-black);
  font-size: 18px;
  font-weight: 600;
  font-family: 'Outfit Regular', sans-serif;
}

.last-market-card .card-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.last-market-card .info-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.last-market-card .info-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.last-market-card .info-label {
  font-weight: 500;
  color: #666;
  font-size: 13px;
  min-width: 70px;
}

.last-market-card .info-value {
  color: var(--mm-black);
  font-size: 14px;
}

.last-market-card .role-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  font-size: 12px;
}

.last-market-card .role-owner {
  background: #e3f2fd;
  color: #1976d2;
}

.last-market-card .role-admin {
  background: #f3e5f5;
  color: #7b1fa2;
}

.last-market-card .role-editor {
  background: #e8f5e9;
  color: #388e3c;
}

.last-market-card .role-viewer {
  background: #fff3e0;
  color: #f57c00;
}

.last-market-card .card-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
}

.last-market-card .open-button {
  padding: 8px 20px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  font-family: 'Outfit Regular', sans-serif;
  box-shadow: 0 2px 4px rgba(73, 176, 150, 0.2);
  white-space: nowrap;
}

.last-market-card .open-button:hover {
  background: #3a9a82;
  box-shadow: 0 4px 8px rgba(73, 176, 150, 0.3);
  transform: translateY(-1px);
}

.button-small {
  width: 346px;
  height: 50px;
  padding: 12px 24px;
}

h3 {
  font-family: 'Merge One';
  font-style: normal;
  font-weight: 100;
  font-size: 20px;
  color: #ffffff;
  margin: 0;
}

h4 {
  font-family: 'Outfit Regular';
  font-style: normal;
  font-weight: 400;
  font-size: 16px;
  color: #ffffff;
  margin: 0;
}

.secondary-buttons {
  display: flex;
  flex-direction: row;
  gap: 24px;
  align-items: center;
  justify-content: center;
  width: 716px;
}
</style>
