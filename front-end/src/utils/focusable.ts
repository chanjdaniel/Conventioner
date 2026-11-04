/**
 * What can take focus, the one list for whoever asks.
 *
 * `:not(:disabled)` is load-bearing: `focus()` on a disabled element is a silent no-op, so a dialog
 * opening on the create-market dialog's organization select, disabled while it fetches, left focus on
 * `<body>`. A `display: none` control matches this too, so a caller that cares checks visibility.
 */
export const FOCUSABLE =
  'a[href], button:not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
