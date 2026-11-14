<script setup lang="ts">
/**
 * Words with addresses in them, each address drawn so it breaks, if a line is too narrow for it,
 * only before its "@" or before a dot, never at a hyphen inside a name (T137 review note 7, T181).
 * The history's table and sentences, the review's warnings, reviewer lines, error lines and reviewed
 * rows, the door code's line of who made it, the rows of Manage market and Manage organization, the
 * rows and chips of a chooser of a market's team, every dialog's title and `VendorIdentity`, a
 * vendor's name and address wherever a screen names them, draw their addresses with it.
 *
 * Each address is one word in the accessible name, and a copy of it is the address: every piece is
 * an inline span, so nothing is added between them, and the break before a piece is a zero-width
 * space drawn by CSS with no alternative text; nothing is hidden. A `<wbr>` or an inline-block
 * piece would each read as a space in Chrome's accessible name.
 */
import { computed } from 'vue';
import { addressParts, dotPieces, hyphenRuns, type AddressPart } from '@/utils/addressParts';

const props = defineProps<{
  /** The words, as a string an address may sit in, or already cut into parts (`addressParts`). */
  words: string | readonly AddressPart[];
}>();

const parts = computed(() =>
  typeof props.words === 'string' ? addressParts(props.words) : props.words,
);
</script>

<template>
  <template v-for="(part, p) in parts" :key="p"
    ><template v-if="part.kind === 'text'">{{ part.text }}</template
    ><template v-else
      ><span v-for="(half, h) in [part.local, part.domain]" :key="h" class="email-address"
        ><span
          v-for="(piece, d) in dotPieces(half)"
          :key="d"
          :class="{ 'email-address-break': h || d }"
          ><template v-for="(run, r) in hyphenRuns(piece)" :key="r"
            ><span v-if="run.held" class="email-address-held">{{ run.text }}</span
            ><template v-else>{{ run.text }}</template></template
          ></span
        ></span
      ></template
    ></template
  >
</template>

<style scoped>
/* An address breaks before its "@" and before each dot first, and inside a piece only when the
   piece alone is wider than the line, an address in a phone's Field column, rather than running
   over what is beside it, whatever the line around it allows. */
.email-address {
  overflow-wrap: anywhere;
}

/* A place the address may break. The first `content` is for a browser that reads no alternative
   text, which skips the second. */
.email-address-break::before {
  content: '\200B';
  content: '\200B' / '';
}

/* A hyphen and the character after it: a line never ends at a hyphen inside a name. */
.email-address-held {
  white-space: nowrap;
}
</style>
