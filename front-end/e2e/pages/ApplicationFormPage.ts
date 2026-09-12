import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Application Form tab of the Market Setup view.
 * Wraps the form builder (field cards, key/label/type/options inputs), the
 * live applicant preview, the save row, and the D9 lock banner.
 */
export class ApplicationFormPage {
  readonly page: Page;

  // Tabs
  readonly formTab: Locator;
  readonly setupTab: Locator;

  // Builder
  readonly builder: Locator;
  readonly builderEmpty: Locator;
  readonly addFieldButton: Locator;
  readonly lockBanner: Locator;
  readonly loadError: Locator;

  // Save row
  readonly saveButton: Locator;
  readonly saveSuccess: Locator;
  readonly saveHint: Locator;
  readonly validationError: Locator;

  // Preview
  readonly preview: Locator;
  readonly previewEmpty: Locator;
  readonly previewEssential: Locator;

  // Essential fields panel (always present in the builder; not removable)
  readonly essentialPanel: Locator;
  readonly essentialBadge: Locator;
  readonly essentialDateChips: Locator;
  readonly essentialSectionChips: Locator;
  readonly essentialTableTypeChips: Locator;
  readonly essentialDatesEmpty: Locator;
  readonly essentialSectionsEmpty: Locator;
  readonly essentialTableTypesEmpty: Locator;

  constructor(page: Page) {
    this.page = page;

    this.formTab = page.getByTestId('market-setup-form-tab');
    this.setupTab = page.getByTestId('market-setup-setup-tab');

    this.builder = page.getByTestId('form-builder');
    this.builderEmpty = page.getByTestId('form-builder-empty');
    this.addFieldButton = page.getByTestId('form-builder-add-field-button');
    this.lockBanner = page.getByTestId('form-builder-lock-banner');
    this.loadError = page.getByTestId('form-builder-load-error');

    this.saveButton = page.getByTestId('form-builder-save-button');
    this.saveSuccess = page.getByTestId('form-builder-save-success');
    this.saveHint = page.getByTestId('form-builder-save-hint');
    this.validationError = page.getByTestId('form-builder-validation-error');

    this.preview = page.getByTestId('form-preview');
    this.previewEmpty = page.getByTestId('form-preview-empty');
    this.previewEssential = page.getByTestId('form-preview-essential');

    this.essentialPanel = page.getByTestId('essential-fields-panel');
    this.essentialBadge = page.getByTestId('essential-fields-badge');
    this.essentialDateChips = page.getByTestId('essential-date-chip');
    this.essentialSectionChips = page.getByTestId('essential-section-chip');
    this.essentialTableTypeChips = page.getByTestId('essential-table-type-chip');
    this.essentialDatesEmpty = page.getByTestId('essential-dates-empty');
    this.essentialSectionsEmpty = page.getByTestId('essential-sections-empty');
    this.essentialTableTypesEmpty = page.getByTestId('essential-table-types-empty');
  }

  async openFormTab(): Promise<void> {
    await this.formTab.click();
    await this.preview.waitFor({ state: 'visible' });
    await this.settleTabTransition();
  }

  async openSetupTab(): Promise<void> {
    await this.setupTab.click();
    await this.settleTabTransition();
  }

  /**
   * The tab buttons cross-fade their colour and underline over 150ms. Screenshots taken inside
   * that window show the outgoing tab still lit, so wait the transition out before asserting or
   * capturing anything about which tab is selected.
   */
  private async settleTabTransition(): Promise<void> {
    await this.page.waitForTimeout(250);
  }

  /** The nth field card in the builder (0-indexed, top to bottom). */
  fieldCard(index: number): Locator {
    return this.builder.locator('.field-item').nth(index);
  }

  labelInput(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-field-label-input');
  }

  keyInput(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-field-key-input');
  }

  typeSelect(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-field-type-select');
  }

  requiredCheckbox(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-field-required-checkbox');
  }

  helpTextInput(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-field-help-input');
  }

  optionInputs(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-field-option-input');
  }

  removeFieldButton(index: number): Locator {
    return this.fieldCard(index).getByTestId('form-builder-remove-field-button');
  }

  async addField(): Promise<void> {
    await this.addFieldButton.click();
  }

  /** Type a label; the key auto-slugs from it until the organizer edits the key. */
  async fillLabel(index: number, label: string): Promise<void> {
    await this.labelInput(index).fill(label);
  }

  async selectType(index: number, type: string): Promise<void> {
    await this.typeSelect(index).selectOption(type);
  }

  async toggleRequired(index: number): Promise<void> {
    await this.requiredCheckbox(index).click();
  }

  async fillHelpText(index: number, text: string): Promise<void> {
    await this.helpTextInput(index).fill(text);
  }

  /** Append an option to a select/multi-select field and fill it. */
  async addOption(index: number, value: string): Promise<void> {
    await this.fieldCard(index).getByTestId('form-field-add-option-button').click();
    await this.optionInputs(index).last().fill(value);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  /** A field in the applicant preview, addressed by its (slugged) key. */
  previewField(key: string): Locator {
    return this.page.getByTestId(`form-preview-field-${key}`);
  }

  /** One of the five essential-question cards in the builder panel. */
  essentialItem(name: string): Locator {
    return this.page.getByTestId(`essential-item-${name}`);
  }
}
