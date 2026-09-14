import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the CSV vendor import flow (`/import-applications`).
 *
 * The flow has four stages on one view: choose a file, map its columns onto the questions the
 * solver reads, resolve any cell value the market does not recognise, then preview and confirm.
 * Nothing is written until the organizer confirms, so `clickPreview` and `clickConfirm` stay
 * separate: most tests assert on what the dry run said before allowing the write.
 */
export class CsvImportPage {
  readonly page: Page;

  // Stage containers, used to assert which stage the flow is showing.
  readonly view: Locator;
  readonly upload: Locator;
  readonly map: Locator;
  readonly preview: Locator;
  readonly wrongPhase: Locator;

  // Choosing a file
  readonly fileInput: Locator;
  readonly filename: Locator;

  // Mapping
  readonly columnRows: Locator;
  readonly unmappedWarning: Locator;
  readonly allMapped: Locator;

  // Grids: several columns the flow read as one question
  readonly groupRows: Locator;
  readonly groupShape: Locator;
  readonly groupMembers: Locator;

  // A mapping restored from the last import of this market
  readonly restoredBanner: Locator;
  readonly restoredNew: Locator;
  readonly restoredBadges: Locator;

  // Cell values the market does not recognise
  readonly valueFixes: Locator;
  readonly unmatchedValues: Locator;
  readonly unresolvedWarning: Locator;

  // The dry run
  readonly previewButton: Locator;
  readonly previewCounts: Locator;
  readonly sampleRows: Locator;
  readonly targetMarket: Locator;
  readonly dropZone: Locator;
  readonly previewMerge: Locator;
  readonly previewFailureRows: Locator;
  readonly absentNote: Locator;
  readonly returningNote: Locator;

  // The write, and what it did
  readonly confirmButton: Locator;
  readonly resultSummary: Locator;
  readonly failureRows: Locator;

  constructor(page: Page) {
    this.page = page;

    this.view = page.getByTestId('import-view');
    this.upload = page.getByTestId('import-upload');
    this.map = page.getByTestId('import-map');
    this.preview = page.getByTestId('import-preview');
    this.wrongPhase = page.getByTestId('import-wrong-phase');

    this.fileInput = page.getByTestId('import-file-input');
    this.filename = page.getByTestId('import-filename');

    this.columnRows = page.getByTestId('import-column-row');
    this.unmappedWarning = page.getByTestId('import-unmapped-warning');
    this.allMapped = page.getByTestId('import-all-mapped');

    this.groupRows = page.getByTestId('import-group-row');
    this.groupShape = page.getByTestId('import-group-shape');
    this.groupMembers = page.getByTestId('import-group-member');

    this.restoredBanner = page.getByTestId('import-restored-banner');
    this.restoredNew = page.getByTestId('import-restored-new');
    this.restoredBadges = page.getByTestId('import-restored-badge');

    this.valueFixes = page.getByTestId('import-value-fixes');
    this.unmatchedValues = page.getByTestId('import-unmatched-value');
    this.unresolvedWarning = page.getByTestId('import-unresolved-warning');

    this.previewButton = page.getByTestId('import-preview-button');
    this.previewCounts = page.getByTestId('import-preview-counts');
    this.sampleRows = page.getByTestId('import-sample-row');
    this.targetMarket = page.getByTestId('import-target-market');
    this.dropZone = page.getByTestId('import-drop-zone');
    this.previewMerge = page.getByTestId('import-preview-merge');
    this.previewFailureRows = page.getByTestId('import-preview-failure-row');
    this.absentNote = page.getByTestId('import-absent-note');
    this.returningNote = page.getByTestId('import-returning-note');

    this.confirmButton = page.getByTestId('import-confirm-button');
    this.resultSummary = page.getByTestId('import-result-summary');
    this.failureRows = page.getByTestId('import-failure-row');
  }

  /**
   * Put a market where every organizer view reads it, then open the import flow.
   *
   * The import view reads the current market from local storage the way the rest of the
   * organizer surface does, so a test that seeded a market over the API arrives here with it.
   */
  async open(market: Record<string, unknown>, userEmail: string): Promise<void> {
    await this.page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m));
        localStorage.setItem('user', JSON.stringify(user));
      },
      { m: market, user: userEmail },
    );
    await this.page.goto('/import-applications');
    await expect(this.view).toBeVisible();
  }

  /** Hand the flow a CSV as though the organizer had picked it off their disk. */
  async chooseFile(contents: string): Promise<void> {
    await this.fileInput.setInputFiles({
      name: 'form-responses.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(contents, 'utf-8'),
    });
  }

  /** Map a target onto one column, by its position in the file. */
  private async mapColumnAt(index: number, targetKey: string): Promise<void> {
    await this.targetSelectAt(index).selectOption(targetKey);
  }

  /**
   * Map targets onto columns named by their headers.
   *
   * `headers` is the file's header row, which is what turns a header into the column position the
   * view addresses its selects by.
   */
  async mapColumns(headers: string[], mapping: Record<string, string>): Promise<void> {
    for (const [header, targetKey] of Object.entries(mapping)) {
      await this.mapColumnAt(this.columnIndex(headers, header), targetKey);
    }
  }

  /** The position the view addresses a column's controls by, from the file's header row. */
  private columnIndex(headers: string[], header: string): number {
    const index = headers.indexOf(header);
    if (index < 0) throw new Error(`Header "${header}" is not in this file`);
    return index;
  }

  /** Map every column of a grid at once, by the position of its first member. */
  private async mapGroupAt(index: number, targetKey: string): Promise<void> {
    await this.page.getByTestId(`import-group-select-${index}`).selectOption(targetKey);
  }

  /** Map a whole grid, naming it by the header of its first member column. */
  async mapGroup(headers: string[], firstMemberHeader: string, targetKey: string): Promise<void> {
    await this.mapGroupAt(this.columnIndex(headers, firstMemberHeader), targetKey);
  }

  /** Tell the flow that bracketed headers it grouped are not one question after all. */
  private async splitGroupAt(index: number): Promise<void> {
    await this.page.getByTestId(`import-split-group-${index}`).click();
  }

  /** Split a grid, naming it by the header of its first member column. */
  async splitGroup(headers: string[], firstMemberHeader: string): Promise<void> {
    await this.splitGroupAt(this.columnIndex(headers, firstMemberHeader));
  }

  /** The select on which a cell value the market does not recognise is resolved. */
  private valueFix(value: string): Locator {
    return this.page.getByTestId(`import-fix-${value}`);
  }

  /** Resolve an unrecognised cell value onto one the market knows. */
  async resolveValue(value: string, to: string): Promise<void> {
    await this.valueFix(value).selectOption(to);
  }

  /** Ask for the dry run. Writes nothing. */
  async clickPreview(): Promise<void> {
    await this.previewButton.click();
  }

  /** Accept the dry run. This is the write. */
  async clickConfirm(): Promise<void> {
    await this.confirmButton.click();
  }

  /** Preview, confirm, and wait for the result - for tests whose subject is elsewhere. */
  async previewAndConfirm(): Promise<void> {
    await this.clickPreview();
    await this.clickConfirm();
    await expect(this.resultSummary).toBeVisible();
  }

  /** The column select at a position, for asserting one is offered at all. */
  targetSelectAt(index: number): Locator {
    return this.page.getByTestId(`import-target-select-${index}`);
  }
}
