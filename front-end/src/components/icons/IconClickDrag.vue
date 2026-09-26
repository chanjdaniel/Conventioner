<!--
  A grip, not a divider (E17/F01/S02).

  It was two vertical strokes at `stroke-width: 0.8` inside `<g opacity="0.25">`, stroked with a
  hardcoded `#222222`. Three things were wrong with that. Two 0.8px hairlines at quarter opacity
  are close to invisible on white; two parallel lines are the shape of a RULE, not of something you
  pick up - the convention is a dot grid, which reads as texture to grip; and the hardcoded colour
  OVERRODE the `color` its wrapper set, so the handle could be neither themed nor given a hover
  state from CSS.

  `currentColor` and no opacity group, so `.drag-handle` owns both.
-->
<template>
  <svg viewBox="0 0 8 12" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="2.5" cy="2" r="1" />
    <circle cx="5.5" cy="2" r="1" />
    <circle cx="2.5" cy="6" r="1" />
    <circle cx="5.5" cy="6" r="1" />
    <circle cx="2.5" cy="10" r="1" />
    <circle cx="5.5" cy="10" r="1" />
  </svg>
</template>
