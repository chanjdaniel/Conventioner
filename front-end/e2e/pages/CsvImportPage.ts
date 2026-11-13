import { expect, type Locator, type Page } from '@playwright/test';
import { marketScreenPath } from '../helpers/marketScreens';
import { ChoiceField } from './ChoiceField';
import { ReviewerChooser } from './ReviewerChooser';

/** One of the import's lists of rows: the first 20, "Show all N", and a find field past 12. */
class ImportList {
  readonly root: Locator;
  readonly find: Locator;
  readonly count: Locator;
  readonly more: Locator;

  constructor(page: Page, testid: string) {
    this.root = page.getByTestId(testid);
    this.find = page.getByTestId(`${testid}-find`);
    this.count = page.getByTestId(`${testid}-count`);
    this.more = page.getByTestId(`${testid}-more`);
  }

  /** Draw every row, if the list stops short of them. */
  async showAll(): Promise<void> {
    if (await this.more.filter({ hasText: /^Show all/ }).isVisible()) await this.more.click();
  }
}

/**
 * Page object for the CSV vendor import flow (`/markets/:marketId/import`).
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
  /** The page's title: "Import responses" on a draft and an archived market, "Redo import" between. */
  readonly heading: Locator;
  readonly upload: Locator;
  readonly map: Locator;
  readonly preview: Locator;
  readonly wrongPhase: Locator;
  /** The refusal's checklist of what a draft's first import waits on (T205/F09). */
  readonly waitsOnHeading: Locator;
  readonly waitsOn: Locator;
  readonly waitsOnLinks: Locator;

  // Choosing a file
  readonly fileInput: Locator;
  readonly filename: Locator;

  readonly error: Locator;

  // Mapping
  readonly columnCount: Locator;
  readonly columnRows: Locator;
  readonly unmappedWarning: Locator;
  readonly allMapped: Locator;

  // Grids: several columns the flow read as one question
  readonly groupRows: Locator;
  readonly groupShape: Locator;
  readonly groupMembers: Locator;

  // A mapping restored from the last import of this market, or from the start of its form
  readonly restoredBanner: Locator;
  readonly restoredNew: Locator;
  readonly restoredBadges: Locator;

  // Cell values the market does not recognise
  readonly valueFixes: Locator;
  readonly unmatchedValues: Locator;
  readonly unresolvedWarning: Locator;
  readonly decidedValues: Locator;
  /** One box of values already decided, per column they belong to. */
  readonly decidedBoxes: Locator;
  readonly backButton: Locator;

  // The dry run
  readonly previewButton: Locator;
  readonly previewCounts: Locator;
  readonly sampleRows: Locator;
  readonly rejectedRows: Locator;
  readonly rejectedCount: Locator;
  /** What the preview says over the rows a rule rejects, naming who may overturn one. */
  readonly rejectedWhy: Locator;
  readonly targetMarket: Locator;
  readonly dropZone: Locator;
  readonly previewMerge: Locator;
  readonly previewFailureRows: Locator;
  readonly previewFailures: ImportList;
  readonly rejected: ImportList;
  readonly repeats: ImportList;
  readonly absentNote: Locator;
  readonly returningNote: Locator;
  readonly repeatNote: Locator;

  // Who reviews what the first import writes (E38/F07/S02)
  readonly reviewers: Locator;
  readonly reviewersError: Locator;

  // The write, and what it did
  readonly confirmButton: Locator;
  readonly resultSummary: Locator;
  readonly failureRows: Locator;
  readonly failures: ImportList;

  constructor(page: Page) {
    this.page = page;

    this.view = page.getByTestId('import-view');
    this.heading = this.view.getByRole('heading', { level: 1 });
    this.upload = page.getByTestId('import-upload');
    this.map = page.getByTestId('import-map');
    this.preview = page.getByTestId('import-preview');
    this.wrongPhase = page.getByTestId('import-wrong-phase');
    this.waitsOnHeading = this.wrongPhase.getByTestId('blocker-heading');
    this.waitsOn = this.wrongPhase.getByTestId('blocker-item');
    this.waitsOnLinks = this.wrongPhase.getByTestId('blocker-resolution-link');

    this.fileInput = page.getByTestId('import-file-input');
    this.error = page.getByTestId('import-error');
    this.filename = page.getByTestId('import-filename');

    this.columnCount = page.getByTestId('import-column-count');
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
    this.decidedValues = page.getByTestId('import-decided-unmatched-value');
    this.decidedBoxes = page.getByTestId('import-decided-value-fixes');
    this.backButton = page.getByTestId('import-back-button');

    this.previewButton = page.getByTestId('import-preview-button');
    this.previewCounts = page.getByTestId('import-preview-counts');
    this.sampleRows = page.getByTestId('import-sample-row');
    this.rejectedRows = page.getByTestId('import-rejected-row');
    this.rejectedCount = page.getByTestId('import-rejected-count');
    this.rejectedWhy = page.getByTestId('import-rejected-why');
    this.targetMarket = page.getByTestId('import-target-market');
    this.dropZone = page.getByTestId('import-drop-zone');
    this.previewMerge = page.getByTestId('import-preview-merge');
    this.previewFailureRows = page.getByTestId('import-preview-failure-row');
    this.absentNote = page.getByTestId('import-absent-note');
    this.returningNote = page.getByTestId('import-returning-note');
    this.repeatNote = page.getByTestId('import-repeat-note');

    this.reviewers = page.getByTestId('import-reviewers');
    this.reviewersError = page.getByTestId('import-reviewers-error');

    this.confirmButton = page.getByTestId('import-confirm-button');
    this.resultSummary = page.getByTestId('import-result-summary');
    this.failureRows = page.getByTestId('import-failure-row');

    this.previewFailures = new ImportList(page, 'import-preview-failures-list');
    this.failures = new ImportList(page, 'import-failures-list');
    this.repeats = new ImportList(page, 'import-repeats-list');
    this.rejected = new ImportList(page, 'import-rejected-list');
  }

  /** What every row the preview refuses says, past its first 20 too. */
  async allPreviewFailures(): Promise<string[]> {
    await this.previewFailures.showAll();
    return await this.previewFailureRows.allInnerTexts();
  }

  /**
   * Open the import flow for a market seeded over the API, by its id - every market screen is
   * addressed by id and takes its market from the server (E21/F02/S04).
   */
  async open(market: Record<string, unknown>): Promise<void> {
    await this.page.goto(marketScreenPath(String(market.id), 'import'));
    await expect(this.view).toBeVisible();
  }

  /** Choose a file named `form-responses.csv`: CSV text, or the bytes of a file that is not one. */
  async chooseFile(contents: string | Buffer): Promise<void> {
    await this.fileInput.setInputFiles({
      name: 'form-responses.csv',
      mimeType: 'text/csv',
      buffer: typeof contents === 'string' ? Buffer.from(contents, 'utf-8') : contents,
    });
  }

  /** Map a target onto one column, by its position in the file. */
  private async mapColumnAt(index: number, targetKey: string): Promise<void> {
    await this.targetSelectAt(index).pick(targetKey);
  }

  /**
   * Map targets onto columns named by their headers.
   *
   * `headers` is the file's header row, which is what turns a header into the column position the
   * view addresses its "Maps to" by.
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
    await this.groupSelectAt(index).pick(targetKey);
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

  /** The control on which a cell value the market does not recognise is resolved. */
  valueFix(value: string): ChoiceField {
    return new ChoiceField(this.page, `import-fix-${value}`);
  }

  /** Resolve an unrecognised cell value onto one the market knows. */
  async resolveValue(value: string, to: string): Promise<void> {
    await this.valueFix(value).choose(to);
  }

  /** Set an unrecognised cell value aside: the choice "Ignore this value", in either control. */
  async ignoreValue(value: string): Promise<void> {
    await this.valueFix(value).choose('__ignore__', 'Ignore this value');
  }

  /** The control on which a decision already made about a value can be changed. */
  decidedFix(value: string): ChoiceField {
    return new ChoiceField(this.page, `import-decided-fix-${value}`);
  }

  /** The select holding such a decision, on a question of 12 answers or fewer. */
  decision(value: string): Locator {
    return this.decidedFix(value).root;
  }

  /** The ledger's row for a column, by the words its header starts with. */
  columnRow(header: string): Locator {
    return this.columnRows.filter({ hasText: header });
  }

  /** The fields a box of values to fix draws, past 12 answers; a select is no such field. */
  fixFields(box: Locator): Locator {
    return box.locator('[data-testid*="-fix-"][data-testid$="-input"]');
  }

  /** The preview step's chooser of reviewers. */
  get reviewerChooser(): ReviewerChooser {
    return new ReviewerChooser(this.reviewers);
  }

  /** Ask for the dry run. Writes nothing. */
  async clickPreview(): Promise<void> {
    await this.previewButton.click();
  }

  /** Accept the dry run. This is the write. */
  async clickConfirm(): Promise<void> {
    await this.confirmButton.click();
  }

  /** Import an export from the upload step to its result: choose, map, preview, confirm. */
  async importCsv(
    contents: string,
    headers: string[],
    mapping: Record<string, string>,
  ): Promise<void> {
    await this.chooseFile(contents);
    await this.mapColumns(headers, mapping);
    await expect(this.allMapped).toBeVisible();
    await this.previewAndConfirm();
  }

  /** Preview, confirm, and wait for the result - for tests whose subject is elsewhere. */
  async previewAndConfirm(): Promise<void> {
    await this.clickPreview();
    await this.clickConfirm();
    await expect(this.resultSummary).toBeVisible();
  }

  /** A column's "Maps to", at its position in the file. */
  targetSelectAt(index: number): ChoiceField {
    return new ChoiceField(this.page, `import-target-select-${index}`);
  }

  /** A grid's "Maps to", at the position of its first member. */
  groupSelectAt(index: number): ChoiceField {
    return new ChoiceField(this.page, `import-group-select-${index}`);
  }
}
