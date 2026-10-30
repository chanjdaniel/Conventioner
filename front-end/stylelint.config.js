/**
 * The design language's gate (`npm run lint:css`; `docs/design-system.md#what-keeps-this-true`).
 *
 * Warnings globally, errors per migrated file: a rule that fails the build on a pre-existing
 * backlog gets switched off, so a slice adds its files to `MIGRATED` when it lands.
 *
 * A module rather than JSON (T82) so the spacing patterns are built once, from named parts, rather
 * than one 300-character regex written four times; `src/__tests__/spacingScale.test.ts` runs this
 * file over what it allows and refuses.
 */

/** The spacing scale's tokens, and the two lengths laid out beside it. */
const TOKEN = String.raw`var\(--(?:space-(?:1|2|3|4|6|8|12|hairline)|card-grid-gap|banner-h)\)`;
/** A phone's safe area: the room a notch or a home bar takes, with an optional fallback. */
const SAFE_AREA = String.raw`env\(safe-area-inset-(?:top|right|bottom|left)(?:,\s*(?:0|${TOKEN}))?\)`;
/** What a sum or a function may be made of: the scale and the safe area, never a bare number. */
const OPERAND = `(?:${TOKEN}|${SAFE_AREA})`;
/** A negated token, or a sum of tokens. `calc(var(--space-1) * 1.5)` is a raw 6px. */
const CALC = String.raw`calc\((?:-1 \* ${TOKEN}|${OPERAND}(?: \+ ${OPERAND})+)\)`;
/** The larger, the smaller or a clamp of the same: `max(var(--space-4), env(safe-area-inset-left))`. */
const COMPARE = String.raw`(?:max|min|clamp)\((?:0|${OPERAND}|${CALC})(?:,\s*(?:0|${OPERAND}|${CALC}))+\)`;
/** A CSS-wide keyword, which is the whole value or nothing. */
const KEYWORD = '(?:inherit|initial|unset|revert|revert-layer)';

/** A value of one or more terms, each set apart by whitespace (`0auto` is no value), or a keyword. */
const values = (...terms) => {
  const term = `(?:${terms.join('|')})`;
  return new RegExp(String.raw`^(?:${KEYWORD}|${term}(?:\s+${term})*)$`);
};

const SPACED = ['0', TOKEN, SAFE_AREA, CALC, COMPARE];
/** `auto` centres a margin; on a padding or a gap it is invalid. */
const MARGIN = values(...SPACED, 'auto');
/** A percentage padding keeps a box's proportions as it scales. */
const PADDING = values(...SPACED, String.raw`\d+(?:\.\d+)?%`);
const GAP = values(...SPACED);

const spacing = (severity) => [
  {
    '/^margin(-[a-z-]+)?$/': [MARGIN],
    '/^padding(-[a-z-]+)?$/': [PADDING],
    '/^(grid-)?(row-|column-)?gap$/': [GAP],
  },
  {
    severity,
    message:
      'Use a --space-* token from base.css - or 0, --space-hairline, --card-grid-gap, --banner-h, a negated token or a sum of them in calc(), env(safe-area-inset-*), max()/min()/clamp() over them, auto on a margin, a percentage on a padding, or a CSS-wide keyword. See docs/design-system.md#spacing.',
  },
];

const rawScale = (options) => [
  {
    '/^font-size$/': ['/^[0-9.]+(px|rem|em)$/'],
    '/^border-radius$/': ['/^[0-9.]+(px|rem)/', '/^[0-9.]+%(?<!50%)/'],
    '/^box-shadow$/': ['/^(?!var\\(|none)/'],
  },
  options,
];

/** Each file a slice has migrated: an error there is a regression, not the backlog. */
const MIGRATED = [
  'src/components/BlockerPanel.vue',
  'src/components/MarketSummaryCard.vue',
  'src/components/MarketPermissions.vue',
  'src/components/MarketArrival.vue',
  'src/components/MarketBar.vue',
  'src/components/MarketPages.vue',
  'src/components/ResultFilterBar.vue',
  'src/components/ResultSeat.vue',
  'src/components/ResultStatistics.vue',
  'src/components/ResultSummary.vue',
  'src/components/MarketFrame.vue',
  'src/components/PageNotFound.vue',
  'src/components/PhaseBadge.vue',
  'src/components/PhaseRail.vue',
  'src/components/PlacementDialog.vue',
  'src/components/SearchPicker.vue',
  'src/components/PlacementHistory.vue',
  'src/components/PlacementHistoryDialog.vue',
  'src/components/VendorNameButton.vue',
  'src/components/SummaryCard.vue',
  'src/components/VendorDateCard.vue',
  'src/components/VendorIdentity.vue',
  'src/components/VendorNotes.vue',
  'src/components/TableShareNotice.vue',
  'src/components/AppDialog.vue',
  'src/components/DeleteOrgDialog.vue',
  'src/components/AddVendorDialog.vue',
  'src/components/ExportVendorsDialog.vue',
  'src/components/AuthCard.vue',
  'src/components/application/AmendFormDialog.vue',
  'src/components/application/ApplicationFormFields.vue',
  'src/components/application/ApplicationMonitor.vue',
  'src/components/application/EssentialApplicationFields.vue',
  'src/components/application/EssentialFieldsPanel.vue',
  'src/components/application/FormBuilder.vue',
  'src/components/application/FormFieldEditor.vue',
  'src/components/application/FormPreview.vue',
  'src/components/application/RankedChoiceInput.vue',
  'src/components/application/AutomaticRejections.vue',
  'src/components/application/ApplicationsAll.vue',
  'src/components/application/FollowUpDialog.vue',
  'src/components/application/ReviewHighlights.vue',
  'src/components/elements/ElementAssignmentOptions.vue',
  'src/components/market/MarketAssignmentTab.vue',
  'src/components/market/MarketPlanTab.vue',
  'src/components/market/MarketFormTab.vue',
  'src/components/StepHeader.vue',
  'src/components/VendorDrawer.vue',
  'src/components/elements/ElementAssignmentPriority.vue',
  'src/components/elements/ElementBanner.vue',
  'src/components/elements/ElementInitButton.vue',
  'src/components/elements/ElementLocationSetup.vue',
  'src/components/elements/ElementMarketDates.vue',
  'src/components/elements/ElementNavigation.vue',
  'src/components/elements/ElementNavigationItem.vue',
  'src/components/elements/ElementOrgSelect.vue',
  'src/components/elements/ElementSectionSetup.vue',
  'src/components/elements/ElementSettingContainer.vue',
  'src/components/elements/ElementSignoutButton.vue',
  'src/components/elements/ElementTierSetup.vue',
  'src/views/AttendanceCheckinView.vue',
  'src/views/AttendanceStatusView.vue',
  'src/views/CsvImportView.vue',
  'src/views/StartFromCsvView.vue',
  'src/components/csvProposal/ProposalLedger.vue',
  'src/components/ValueFixes.vue',
  'src/views/DashboardView.vue',
  'src/views/EmailVerificationView.vue',
  'src/views/InitView.vue',
  'src/views/LoadMarketOverlay.vue',
  'src/views/MarketLanding.vue',
  'src/views/LoginView.vue',
  'src/views/ManageMarketOverlay.vue',
  'src/views/ManageOrgOverlay.vue',
  'src/views/MarketSetupView.vue',
  'src/views/MarketsView.vue',
  'src/views/NewMarketOverlay.vue',
  'src/views/OrganizationsView.vue',
  'src/views/PasswordResetRequestView.vue',
  'src/views/PasswordResetView.vue',
  'src/views/ResultView.vue',
  'src/views/VendorsView.vue',
  'src/views/ApplicantDashboard.vue',
  'src/views/ApplicantLogin.vue',
  'src/views/ApplicationPage.vue',
  'src/views/MarketHomeView.vue',
  'src/views/FloorplanEditorView.vue',
  'src/App.vue',
  'src/assets/main.css',
  'src/components/AnswerValue.vue',
  'src/components/NothingAssigned.vue',
  'src/components/elements/ElementIntakeMode.vue',
  'src/components/market/MarketApplicationsTab.vue',
];

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-html/vue'],
  rules: {
    'color-no-hex': [
      true,
      {
        severity: 'warning',
        message:
          'Use a --mm-* token from base.css. 351 hardcoded colours, nine reds for one semantic role, and a red that could not carry white text is how the product got here (E16/F02).',
      },
    ],
    'declaration-property-value-disallowed-list': rawScale({
      severity: 'warning',
      message:
        'Use a scale token from base.css - --text-*, --radius-*, --shadow-card. See docs/design-system.md.',
    }),
    'declaration-property-value-allowed-list': spacing('warning'),
  },
  ignoreFiles: ['dist/**', 'node_modules/**', 'src/assets/base.css', 'src/assets/primitives.css'],
  overrides: [
    {
      files: MIGRATED,
      rules: {
        'color-no-hex': [true, { severity: 'error' }],
        'declaration-property-value-disallowed-list': rawScale({ severity: 'error' }),
        'declaration-property-value-allowed-list': spacing('error'),
      },
    },
  ],
};
