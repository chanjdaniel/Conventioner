<script setup lang="ts">
defineEmits<{
  select: [path: 'manual' | 'floorplan']
}>()
</script>

<template>
  <div class="overlay-backdrop">
    <div class="overlay-panel">
      <h2 class="overlay-heading">Choose Your Setup Path</h2>
      <p class="overlay-subtitle">How would you like to configure your market layout?</p>

      <div class="cards-row">
        <!-- ─── Manual Setup Card ─── -->
        <div class="path-card" @click="$emit('select', 'manual')" data-testid="choose-path-manual">
          <div class="card-icon-wrapper">
            <i class="pi pi-list card-icon" />
          </div>

          <h3 class="card-title">Manual Setup</h3>
          <p class="card-desc">Text-based section, tier, and location configuration</p>

          <ul class="card-features">
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Define sections, tiers &amp; locations manually</span>
            </li>
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Full control over every configuration detail</span>
            </li>
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Familiar step-by-step setup flow</span>
            </li>
          </ul>

          <button class="card-action" type="button">
            Get Started
          </button>
        </div>

        <!-- ─── Floorplan AI Card ─── -->
        <div class="path-card card-floorplan" @click="$emit('select', 'floorplan')">
          <span class="beta-badge">BETA</span>

          <div class="card-icon-wrapper">
            <i class="pi pi-image card-icon" />
          </div>

          <h3 class="card-title">Floorplan AI</h3>
          <p class="card-desc">Upload an image, auto-detect layout, place tables visually</p>

          <ul class="card-features">
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Upload a floorplan image or PDF</span>
            </li>
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Auto-detect walls &amp; obstacles</span>
            </li>
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Place &amp; arrange tables visually</span>
            </li>
            <li>
              <i class="pi pi-check-circle feature-check" />
              <span>Drag, resize &amp; snap with precision</span>
            </li>
          </ul>

          <button class="card-action card-action--accent" type="button">
            Try Beta
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Overlay Backdrop ─────────────────────────────────────────── */
.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  animation: fade-in 0.2s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Panel ────────────────────────────────────────────────────── */
.overlay-panel {
  width: min(90vw, 880px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 40px 36px 36px;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
  animation: slide-up 0.25s ease-out;
  overflow-y: auto;
}

@keyframes slide-up {
  from { transform: translateY(24px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.overlay-heading {
  font-family: 'Merge One', sans-serif;
  font-size: 26px;
  font-weight: 400;
  color: var(--mm-black);
  text-align: center;
  margin: 0;
}

.overlay-subtitle {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 15px;
  color: var(--mm-grey);
  text-align: center;
  margin: 0;
}

/* ── Cards Row ────────────────────────────────────────────────── */
.cards-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}

/* ── Path Card ────────────────────────────────────────────────── */
.path-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 22px 24px;
  background: #ffffff;
  border: 2px solid var(--mm-grey);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out,
    transform 0.15s ease-in-out;
  user-select: none;
}

.path-card:hover {
  border-color: var(--mm-green);
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.path-card:active {
  transform: translateY(0);
}

/* ── Floorplan card accent border on hover ── */
.card-floorplan:hover {
  border-color: var(--mm-yellow);
}

/* ── Card Icon ────────────────────────────────────────────────── */
.card-icon-wrapper {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mm-beige);
  border-radius: 50%;
  flex-shrink: 0;
}

.card-icon {
  font-size: 26px;
  color: var(--mm-black);
}

/* Floorplan card icon accent */
.card-floorplan .card-icon {
  color: var(--mm-yellow);
}

/* ── Card Title ───────────────────────────────────────────────── */
.card-title {
  font-family: 'Merge One', sans-serif;
  font-size: 20px;
  font-weight: 400;
  color: var(--mm-black);
  text-align: center;
  margin: 0;
}

.card-desc {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-grey);
  text-align: center;
  line-height: 1.5;
  margin: 0;
  max-width: 260px;
}

/* ── Features List ────────────────────────────────────────────── */
.card-features {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.card-features li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
  line-height: 1.45;
}

.feature-check {
  font-size: 14px;
  color: var(--mm-green);
  flex-shrink: 0;
  margin-top: 1px;
}

.card-floorplan .feature-check {
  color: var(--mm-yellow);
}

/* ── Action Button ────────────────────────────────────────────── */
.card-action {
  margin-top: auto;
  width: 140px;
  height: 36px;
  background: var(--mm-green);
  border: none;
  border-radius: 5px;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  color: #ffffff;
  cursor: pointer;
  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.card-action:hover {
  opacity: 0.9;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.card-action--accent {
  background: var(--mm-yellow);
  color: var(--mm-black);
}

.card-action--accent:hover {
  background: color-mix(in srgb, var(--mm-yellow) 85%, black);
  opacity: 0.9;
}

/* ── Beta Badge ───────────────────────────────────────────────── */
.beta-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 3px 10px;
  background: var(--mm-yellow);
  border-radius: 100px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--mm-black);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Responsive: stack on narrow screens ──────────────────────── */
@media (max-width: 640px) {
  .overlay-panel {
    width: 95vw;
    padding: 28px 20px 24px;
    gap: 16px;
  }

  .overlay-heading {
    font-size: 22px;
  }

  .cards-row {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
