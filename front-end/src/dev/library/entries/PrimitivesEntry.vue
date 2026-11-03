<script setup lang="ts">
/**
 * The primitive layer (`src/assets/primitives.css`, `docs/design-system.md#the-primitive-layer`)
 * in every variant and state: what every screen is drawn from.
 *
 * The live controls answer the pointer and the keyboard as the product's do. Beside them, the
 * hover, pressed and focus states are drawn held, so they can be compared at a glance; the classes
 * that hold them (`is-hover`, `is-pressed`, `is-focus` below) copy what `primitives.css` draws on
 * `:hover`, `:active` and `:focus-visible`, and the live control is the one to trust where they
 * differ.
 */
import { ref } from 'vue';
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconClickDrag from '@/components/icons/IconClickDrag.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import ReadOut from '../parts/ReadOut.vue';
import { LIBRARY_PATH } from '../catalog';
import { fixture } from '../fixture';

const INTENTS = [
  { label: 'Primary', classes: 'btn--primary' },
  { label: 'Secondary', classes: 'btn--secondary' },
  { label: 'Destructive', classes: 'btn--destructive' },
  { label: "A row's destructive", classes: 'btn--secondary btn--destructive' },
] as const;

const HELD = [
  { label: 'Hover', holds: 'is-hover' },
  { label: 'Held down', holds: 'is-pressed' },
  { label: 'Focus', holds: 'is-focus' },
] as const;

const TONES = ['neutral', 'positive', 'attention', 'informational', 'destructive'] as const;

const CHOICES = [
  { id: 'form', label: 'On our page', help: "Vendors apply on the market's own page." },
  { id: 'csv', label: 'From a Google Form', help: 'You import its responses.' },
];

const first = fixture.applications[0]!;
const business = ref(first.business);
const name = ref(first.name);
const sells = ref(first.sells);
const section = ref('North Wing');
const toggled = ref(['Open']);
const pressedCount = ref(0);
const chosenCard = ref('form');

function toggle(label: string) {
  toggled.value = toggled.value.includes(label)
    ? toggled.value.filter((value) => value !== label)
    : [...toggled.value, label];
}
</script>

<template>
  <LibrarySection title="Buttons" about=".btn with one intent, standard or compact">
    <LibraryPanel v-for="intent in INTENTS" :key="intent.label" :label="intent.label">
      <button type="button" class="btn" :class="intent.classes" @click="pressedCount++">
        Rest
      </button>
      <button
        v-for="held in HELD"
        :key="held.label"
        type="button"
        class="btn"
        :class="[intent.classes, held.holds]"
        tabindex="-1"
      >
        {{ held.label }}
      </button>
      <button type="button" class="btn" :class="intent.classes" disabled>Disabled</button>
    </LibraryPanel>
    <LibraryPanel label="Compact">
      <button
        v-for="intent in INTENTS"
        :key="intent.label"
        type="button"
        class="btn btn--compact"
        :class="intent.classes"
        @click="pressedCount++"
      >
        {{ intent.label }}
      </button>
      <button type="button" class="btn btn--compact btn--secondary" disabled>Disabled</button>
    </LibraryPanel>
    <LibraryPanel label="Toggle (aria-pressed)">
      <div class="library-row" role="group" aria-label="Statuses">
        <button
          v-for="label in ['Open', 'Approved', 'Rejected']"
          :key="label"
          type="button"
          class="btn btn--secondary"
          :aria-pressed="toggled.includes(label)"
          @click="toggle(label)"
        >
          {{ label }}
        </button>
      </div>
      <ReadOut label="Pressed" :value="toggled" />
    </LibraryPanel>
    <LibraryPanel label="Pressed by you">
      <ReadOut label="Buttons pressed" :value="String(pressedCount)" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="Fields" about=".field, .field--select, .field--textarea and .field-label">
    <LibraryPanel label="Text: empty">
      <label class="library-field">
        <span class="field-label">Business name</span>
        <input
          name="business-empty"
          autocomplete="off"
          class="field"
          type="text"
          placeholder="Your business's name"
        />
      </label>
    </LibraryPanel>
    <LibraryPanel label="Text: filled">
      <label class="library-field">
        <span class="field-label">Business name</span>
        <input v-model="business" name="business" autocomplete="off" class="field" type="text" />
      </label>
      <ReadOut label="Typed" :value="business" />
    </LibraryPanel>
    <LibraryPanel label="Text: disabled">
      <label class="library-field">
        <span class="field-label">Full name</span>
        <input
          name="full-name"
          autocomplete="off"
          class="field"
          type="text"
          :value="name"
          disabled
        />
      </label>
    </LibraryPanel>
    <LibraryPanel label="Text: with error, as Pricing marks it">
      <label class="library-field">
        <span class="field-label">Price group</span>
        <input
          name="price-group"
          autocomplete="off"
          class="field error-ringed"
          type="text"
          value=""
          aria-invalid="true"
        />
      </label>
    </LibraryPanel>
    <LibraryPanel label="Text: with error, as Verify email says it">
      <label class="library-field">
        <span class="field-label">Email address</span>
        <input
          name="email"
          autocomplete="off"
          class="field"
          type="email"
          value="not-an-address"
          aria-invalid="true"
          aria-describedby="library-field-error"
        />
        <span id="library-field-error" class="error-line">Enter an email address.</span>
      </label>
    </LibraryPanel>
    <LibraryPanel label="Select: empty">
      <label class="library-field">
        <span class="field-label">Section</span>
        <select name="section-empty" class="field field--select">
          <option value="" disabled selected>Choose a section</option>
          <option>North Wing</option>
          <option>South Wing</option>
        </select>
      </label>
    </LibraryPanel>
    <LibraryPanel label="Select: filled">
      <label class="library-field">
        <span class="field-label">Section</span>
        <select v-model="section" name="section" class="field field--select">
          <option>North Wing</option>
          <option>South Wing</option>
        </select>
      </label>
      <ReadOut label="Chosen" :value="section" />
    </LibraryPanel>
    <LibraryPanel label="Select: disabled">
      <label class="library-field">
        <span class="field-label">Section</span>
        <select name="section-disabled" class="field field--select" disabled>
          <option>North Wing</option>
        </select>
      </label>
    </LibraryPanel>
    <LibraryPanel label="Select: with error, as Pricing marks it">
      <label class="library-field">
        <span class="field-label">Section</span>
        <select name="section-error" class="field field--select error-ringed" aria-invalid="true">
          <option value="" selected>Choose a section</option>
          <option>North Wing</option>
        </select>
      </label>
    </LibraryPanel>
    <LibraryPanel label="Textarea: filled">
      <label class="library-field">
        <span class="field-label">What kinds of work will you sell?</span>
        <textarea v-model="sells" name="sells" class="field field--textarea"></textarea>
      </label>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="Chips" about=".chip in its five tones">
    <LibraryPanel label="Tones">
      <span v-for="tone in TONES" :key="tone" class="chip" :class="`chip--${tone}`">{{
        tone
      }}</span>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="Add-row, drag handle and link" about=".add-row, .drag-handle, .link-alone">
    <LibraryPanel label="Add-row">
      <button type="button" class="add-row">
        <IconAddRound class="add-row__icon" />
        Add a section
      </button>
      <button type="button" class="add-row is-focus" tabindex="-1">
        <IconAddRound class="add-row__icon" />
        Focus
      </button>
    </LibraryPanel>
    <LibraryPanel label="Drag handle">
      <span class="library-handle-row">
        <span class="drag-handle" aria-hidden="true"
          ><IconClickDrag class="drag-handle__icon"
        /></span>
        Rest
      </span>
      <span class="library-handle-row">
        <span class="drag-handle is-hover-ink" aria-hidden="true"
          ><IconClickDrag class="drag-handle__icon"
        /></span>
        Hover
      </span>
    </LibraryPanel>
    <LibraryPanel label="Link alone">
      <RouterLink class="link-alone" :to="LIBRARY_PATH">All components</RouterLink>
      <RouterLink class="link-alone is-underlined" :to="LIBRARY_PATH" tabindex="-1"
        >All components, hovered</RouterLink
      >
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="Card grid" about=".card-grid: half cards, and one wide">
    <LibraryPanel label="Half and wide" class="library-wide">
      <div class="card-grid library-grid">
        <div class="library-card">
          <strong>Applications</strong>
          <span>{{ fixture.applications.length }} applications</span>
        </div>
        <div class="library-card">
          <strong>People with access</strong>
          <span>{{ fixture.people.length }} people</span>
        </div>
        <div class="library-card card-grid__wide">
          <strong>A wide card</strong>
          <span>It takes both tracks, at any width.</span>
        </div>
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="Note and choice cards" about=".note, .choice-card">
    <LibraryPanel label="Note">
      <p class="note">
        The rules are settled: <RouterLink :to="LIBRARY_PATH">see every component</RouterLink>.
      </p>
    </LibraryPanel>
    <LibraryPanel label="Choice cards">
      <div class="library-stack" role="radiogroup" aria-label="How vendors apply">
        <label
          v-for="choice in CHOICES"
          :key="choice.id"
          class="choice-card"
          :class="{ chosen: chosenCard === choice.id }"
        >
          <input v-model="chosenCard" type="radio" name="library-choice" :value="choice.id" />
          <span class="choice-card-text">
            <span class="choice-card-label">{{ choice.label }}</span>
            <span class="choice-card-help">{{ choice.help }}</span>
          </span>
        </label>
      </div>
      <ReadOut label="Chosen" :value="chosenCard" />
    </LibraryPanel>
    <LibraryPanel label="Choice cards: frozen">
      <div class="library-stack">
        <label class="choice-card disabled chosen">
          <input type="radio" name="library-frozen" checked disabled />
          <span class="choice-card-text">
            <span class="choice-card-label">On our page</span>
            <span class="choice-card-help">Chosen, and settled.</span>
          </span>
        </label>
        <label class="choice-card disabled">
          <input type="radio" name="library-frozen" disabled />
          <span class="choice-card-text">
            <span class="choice-card-label">From a Google Form</span>
            <span class="choice-card-help">Not chosen.</span>
          </span>
        </label>
      </div>
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      A field has no error state of its own: Pricing rings it in red, Verify email writes a red line
      under it. Which one becomes <code>.field[aria-invalid]</code>, or both?
    </li>
    <li>
      A row's destructive is red ink on the secondary button: keep it a variant, or give it a name
      of its own?
    </li>
    <li>Are the held hover, pressed and focus copies worth keeping beside the live controls?</li>
  </ChoicesForYou>
</template>

<style scoped>
/* What `primitives.css` draws on `:hover`, `:active` and `:focus-visible`, held still. */
.btn.is-hover {
  opacity: 0.9;
}

.btn.is-pressed {
  opacity: 0.8;
}

.is-focus {
  box-shadow: var(--focus-halo);
}

.is-hover-ink {
  color: var(--mm-black);
}

.is-underlined {
  text-decoration: underline;
}

/* The two error looks the product has today, each a screen's own rule. */
.error-ringed {
  border-color: var(--mm-red);
}

.error-line {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.library-field {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.library-row,
.library-stack {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.library-stack {
  flex-direction: column;
  width: 100%;
}

.library-handle-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-height);
  font-size: var(--text-sm);
}

.library-wide {
  grid-column: 1 / -1;
}

.library-grid {
  width: 100%;
}

.library-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  box-shadow: var(--shadow-card);
  font-size: var(--text-sm);
}

.library-card strong {
  font-weight: 600;
}
</style>
