<script setup lang="ts">
const handleLoadLastMarket = () => {
  console.log('Load Last Market clicked');
};

const handleMarkets = () => {
  console.log('Markets clicked');
};

const handleOrganizations = () => {
  console.log('Organizations clicked');
};

const handleSettings = () => {
  console.log('Settings clicked');
};

const handleSignOut = () => {
  console.log('Sign Out clicked');
};
</script>

<template>
  <div class="dashboard-view">
    <div class="main-buttons">
      <button class="button button-full" @click="handleLoadLastMarket">
        <h3>Load Last Market</h3>
      </button>
      
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
        <h4>Sign Out</h4>
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
