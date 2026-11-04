<script setup lang="ts">
/**
 * The emailed six-digit sign-in code's field, one for both sign-ins: the vendor page's code step
 * and the organizer's "Sign-in code" step (T191 F21).
 *
 * Its digits are centred on the box. A browser adds letter-spacing after every character, the last
 * one too, so a centred run of six spaced digits sat half a space left of centre; an indent of the
 * same width takes that half back, and both read one custom property so they cannot drift apart.
 * The placeholder clears on focus, so the empty field's caret, drawn at the box's centre, is never
 * drawn inside the digit group; the caller's label names the field, so the placeholder is not its
 * only name ([every control is named]).
 *
 * The caller's attributes (`id`, `data-testid`, `required`, `pattern`) fall through to the input.
 */
import { ref } from 'vue';

const code = defineModel<string>({ required: true });

const input = ref<HTMLInputElement | null>(null);

defineExpose({
  /** Put the caret in the field, as a refused code's retry does. */
  focus: () => input.value?.focus(),
});
</script>

<template>
  <input
    ref="input"
    v-model="code"
    class="field code-input"
    type="text"
    inputmode="numeric"
    autocomplete="one-time-code"
    maxlength="6"
    placeholder="000000"
  />
</template>

<style scoped>
/* `.field`'s box and border; the code is the one field read at a glance, so it is larger. */
.code-input {
  --code-spacing: 12px;
  height: 48px;
  font-size: var(--text-xl);
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--code-spacing);
  text-indent: var(--code-spacing);
  text-align: center;
}

.code-input:focus::placeholder {
  color: transparent;
}
</style>
