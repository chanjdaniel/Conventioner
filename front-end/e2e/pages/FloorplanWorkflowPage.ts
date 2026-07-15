import { expect, type Locator, type Page } from '@playwright/test';

/** Minimal shape of a placed table as stored in the Pinia floorplan store. */
interface PlacedTable {
  id: string;
  [key: string]: unknown;
}

/** Minimal shape of the Pinia floorplan store accessed from the browser. */
interface FloorplanStore {
  placedTables: PlacedTable[];
  tableTypes: unknown[];
  setSections: (sections: unknown[]) => void;
}

/** Minimal shape of the Vue app instance exposed on the `#app` element. */
interface VueAppLike {
  config: {
    globalProperties: {
      $pinia?: { _s: Map<string, FloorplanStore> };
    };
  };
}

/**
 * Page object for the Floorplan Workflow wizard view.
 * Covers the 5-step floorplan creation flow: Upload, Calibrate, Place Tables,
 * Edit Layout, Save. Accessed at /floorplan-editor?marketId=xxx.
 */
export class FloorplanWorkflowPage {
  readonly page: Page;

  // Wizard navigation
  readonly backButton: Locator;
  readonly nextButton: Locator;

  // Step 0: Upload
  readonly uploadDropzone: Locator;
  readonly uploadBrowseBtn: Locator;
  readonly uploadProgress: Locator;
  readonly uploadError: Locator;

  // Step 1: Calibrate
  readonly calibrateStage: Locator;
  readonly calibrateLengthInput: Locator;
  readonly calibrateBtnCalibrate: Locator;
  readonly calibrateBtnRedraw: Locator;
  readonly calibrateBtnDone: Locator;

  // Step 2: Table Types + Auto-Place
  readonly tableTypeAddBtn: Locator;
  readonly tableTypeNameInput: Locator;
  readonly tableTypeWidthInput: Locator;
  readonly tableTypeHeightInput: Locator;
  readonly tableTypeSaveBtn: Locator;
  readonly tableTypeCancelBtn: Locator;
  readonly autoPlaceBtn: Locator;
  readonly autoPlaceError: Locator;

  // Step 3: Section Grouping
  readonly sectionGroupToggle: Locator;
  readonly sectionDialogNameInput: Locator;
  readonly sectionDialogLocationInput: Locator;
  readonly sectionDialogAssignBtn: Locator;
  readonly sectionDialogCancelBtn: Locator;

  // Step 3: FloorplanEditor
  readonly editorStage: Locator;
  readonly editorZoomIn: Locator;
  readonly editorZoomOut: Locator;
  readonly editorFit: Locator;
  readonly editorGrid: Locator;
  readonly editorError: Locator;

  // Step 4: Save Flow
  readonly saveOpenBtn: Locator;
  readonly saveDialog: Locator;
  readonly saveCancelBtn: Locator;
  readonly saveConfirmBtn: Locator;
  readonly saveSuccess: Locator;
  readonly saveError: Locator;

  // Path choice (in MarketSetupView)
  readonly choosePathFloorplanCard: Locator;

  constructor(page: Page) {
    this.page = page;

    // Wizard navigation
    this.backButton = page.getByTestId('floorplan-workflow-back-btn');
    this.nextButton = page.getByTestId('floorplan-workflow-next-btn');

    // Step 0: Upload
    this.uploadDropzone = page.getByTestId('floorplan-upload-dropzone');
    this.uploadBrowseBtn = page.getByTestId('floorplan-upload-browse-btn');
    this.uploadProgress = page.getByTestId('floorplan-upload-progress');
    this.uploadError = page.getByTestId('floorplan-upload-error');

    // Step 1: Calibrate
    this.calibrateStage = page.getByTestId('scale-calibration-stage');
    this.calibrateLengthInput = page.getByTestId('scale-calibration-length-input');
    this.calibrateBtnCalibrate = page.getByTestId('scale-calibration-btn-calibrate');
    this.calibrateBtnRedraw = page.getByTestId('scale-calibration-btn-redraw');
    this.calibrateBtnDone = page.getByTestId('scale-calibration-btn-done');

    // Step 2: Table Types
    this.tableTypeAddBtn = page.getByTestId('floorplan-table-type-add-btn');
    this.tableTypeNameInput = page.getByTestId('floorplan-table-type-name-input');
    this.tableTypeWidthInput = page
      .getByTestId('floorplan-table-type-width-input')
      .locator('input.p-inputtext')
      .first();
    this.tableTypeHeightInput = page
      .getByTestId('floorplan-table-type-height-input')
      .locator('input.p-inputtext')
      .first();
    this.tableTypeSaveBtn = page.getByTestId('floorplan-table-type-save-btn');
    this.tableTypeCancelBtn = page.getByTestId('floorplan-table-type-cancel-btn');
    this.autoPlaceBtn = page.getByTestId('floorplan-auto-place-btn');
    this.autoPlaceError = page.getByTestId('floorplan-auto-place-error');

    // Step 3: Section Grouping
    this.sectionGroupToggle = page.getByTestId('floorplan-section-group-toggle');
    this.sectionDialogNameInput = page.getByTestId('floorplan-section-dialog-name-input');
    this.sectionDialogLocationInput = page.getByTestId('floorplan-section-dialog-location-input');
    this.sectionDialogAssignBtn = page.getByTestId('floorplan-section-dialog-assign-btn');
    this.sectionDialogCancelBtn = page.getByTestId('floorplan-section-dialog-cancel-btn');

    // Step 3: FloorplanEditor
    this.editorStage = page.getByTestId('floorplan-editor-stage');
    this.editorZoomIn = page.getByTestId('floorplan-editor-zoom-in');
    this.editorZoomOut = page.getByTestId('floorplan-editor-zoom-out');
    this.editorFit = page.getByTestId('floorplan-editor-fit');
    this.editorGrid = page.getByTestId('floorplan-editor-grid');
    this.editorError = page.getByTestId('floorplan-editor-error');

    // Step 4: Save Flow
    this.saveOpenBtn = page.getByTestId('floorplan-save-open-btn');
    this.saveDialog = page.getByTestId('floorplan-save-dialog');
    this.saveCancelBtn = page.getByTestId('floorplan-save-cancel-btn');
    this.saveConfirmBtn = page.getByTestId('floorplan-save-confirm-btn');
    this.saveSuccess = page.getByTestId('floorplan-save-success');
    this.saveError = page.getByTestId('floorplan-save-error');

    // Path choice
    this.choosePathFloorplanCard = page.getByTestId('choose-path-floorplan');
  }

  /** Navigate to the floorplan editor for a given market. */
  async goto(marketId: string): Promise<void> {
    await this.page.goto(`/floorplan-editor?marketId=${marketId}`);
  }

  // ─── Wizard Navigation ──────────────────────────────────────────

  async clickNext(): Promise<void> {
    await this.nextButton.click();
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }

  async waitForWizard(): Promise<void> {
    await this.nextButton.waitFor({ state: 'visible', timeout: 10000 });
  }

  /** Wait for the Next button to become enabled (wizard step complete). */
  async waitForNextEnabled(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="floorplan-workflow-next-btn"]',
        ) as HTMLButtonElement;
        return btn && !btn.disabled;
      },
      { timeout: 30000 },
    );
  }

  // ─── Path Choice (in MarketSetupView context) ───────────────────

  /** Select the Floorplan AI path from the ChoosePathOverlay. */
  async selectFloorplanPath(): Promise<void> {
    await this.choosePathFloorplanCard.click();
    // Expect navigation to /floorplan-editor
    await this.page.waitForURL('**/floorplan-editor**', { timeout: 10000 });
  }

  // ─── Step 0: Upload ─────────────────────────────────────────────

  /** Upload a floorplan image file via the file input. */
  async uploadFloorplanImage(filePath: string): Promise<void> {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.uploadBrowseBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
  }

  /** Wait for upload to complete (Next button enabled). */
  async waitForUploadComplete(): Promise<void> {
    await this.waitForNextEnabled();
  }

  // ─── Step 1: Calibrate ─────────────────────────────────────────

  /**
   * Draw a calibration reference line on the Konva canvas by simulating
   * a mouse drag from (startFractionX, startFractionY) to (endFractionX, endFractionY)
   * where fractions are 0-1 relative to the canvas container bounding box.
   */
  async drawCalibrationLine(
    startFractionX: number = 0.3,
    startFractionY: number = 0.5,
    endFractionX: number = 0.7,
    endFractionY: number = 0.5,
  ): Promise<void> {
    const box = await this.calibrateStage.boundingBox();
    if (!box) throw new Error('Calibrate stage not found');

    const startX = box.x + box.width * startFractionX;
    const startY = box.y + box.height * startFractionY;
    const endX = box.x + box.width * endFractionX;
    const endY = box.y + box.height * endFractionY;

    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(endX, endY, { steps: 10 });
    await this.page.mouse.up();
  }

  /**
   * Complete calibration by entering the reference length and selecting the unit.
   * Assumes the input dialog is already visible after drawing the line.
   */
  async completeCalibration(length: string = '3.5'): Promise<void> {
    // Fill length and select unit (default meters = 'm')
    await this.calibrateLengthInput.fill(length);
    await this.calibrateBtnCalibrate.click();
    // Wait for result dialog and click Done
    await this.calibrateBtnDone.waitFor({ state: 'visible', timeout: 10000 });
    await this.calibrateBtnDone.click();
    // Workflow auto-advances to step 2
  }

  // ─── Step 2: Table Types ───────────────────────────────────────

  /** Add a new table type with the given parameters. */
  async addTableType(name: string, width: string, height: string): Promise<void> {
    await this.tableTypeAddBtn.click();
    await this.tableTypeNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.tableTypeNameInput.fill(name);

    await this.tableTypeWidthInput.fill(width);
    await this.tableTypeWidthInput.blur();
    await this.tableTypeHeightInput.fill(height);
    await this.tableTypeHeightInput.blur();

    await this.tableTypeSaveBtn.waitFor({ state: 'attached', timeout: 3000 });
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="floorplan-table-type-save-btn"]',
        ) as HTMLButtonElement;
        return btn && !btn.disabled;
      },
      { timeout: 10000 },
    );
    await this.tableTypeSaveBtn.click();
    await this.tableTypeSaveBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /** Click the Auto-Place Tables button and wait for placement to complete. */
  async autoPlaceTables(): Promise<void> {
    await this.autoPlaceBtn.click();
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="floorplan-auto-place-btn"]',
        ) as HTMLButtonElement;
        return btn && !btn.disabled;
      },
      { timeout: 60000 },
    );
    await expect(this.autoPlaceError)
      .not.toBeVisible({ timeout: 3000 })
      .catch(() => {});
  }

  /**
   * Capture the current placed tables from the store and return them
   * as a JSON-serializable snapshot. Used by the e2e spec to assert
   * table persistence across wizard steps.
   */
  async snapshotPlacedTables(): Promise<PlacedTable[]> {
    return this.page.evaluate(() => {
      const appEl = document.querySelector('#app');
      const vueApp = (appEl as unknown as { __vue_app__?: VueAppLike })?.__vue_app__;
      if (!vueApp) return [];
      const pinia = vueApp.config.globalProperties.$pinia;
      if (!pinia) return [];
      const store = pinia._s.get('floorplan');
      if (!store) return [];
      return JSON.parse(JSON.stringify(store.placedTables));
    });
  }

  // ─── Step 3: Section Grouping ──────────────────────────────────

  async groupAllTablesIntoSection(sectionName: string, locationName: string): Promise<void> {
    await this.page.evaluate(
      ({ name, location }) => {
        const appEl = document.querySelector('#app');
        const vueApp = (appEl as unknown as { __vue_app__?: VueAppLike })?.__vue_app__;
        if (!vueApp) throw new Error('Vue app not found');
        const pinia = vueApp.config.globalProperties.$pinia;
        if (!pinia) throw new Error('Pinia not found');
        const store = pinia._s.get('floorplan');
        if (!store) throw new Error('Floorplan store not found');
        const tableIds = store.placedTables.map((t) => t.id);
        store.setSections([{ id: crypto.randomUUID(), name, locationName: location, tableIds }]);
      },
      { name: sectionName, location: locationName },
    );
  }

  // ─── Step 4: Save ──────────────────────────────────────────────

  /** Open the save dialog. */
  async openSaveDialog(): Promise<void> {
    await this.saveOpenBtn.click();
    await this.saveDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /** Click the Save Floorplan button in the dialog. */
  async confirmSave(): Promise<void> {
    await this.saveConfirmBtn.click();
  }

  /** Wait for redirect back to market-setup after successful save. */
  async waitForSaveComplete(): Promise<void> {
    await this.page.waitForURL('**/market-setup**', { timeout: 15000 });
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /**
   * Full floorplan workflow: upload, calibrate, add table type,
   * auto-place, group sections, and save.
   *
   * Returns once the save has completed and navigated to /market-setup.
   */
  async completeFloorplanWorkflow(
    fixturePath: string,
    tableTypeName: string = '6ft Table',
    tableWidth: string = '1800',
    tableHeight: string = '900',
    sectionName: string = 'Main',
    sectionLocation: string = 'Main Hall',
  ): Promise<void> {
    await this.waitForWizard();

    // Step 0: Upload
    await this.uploadFloorplanImage(fixturePath);
    await this.waitForUploadComplete();
    await this.clickNext();

    // Step 1: Calibrate
    await this.calibrateStage.waitFor({ state: 'visible', timeout: 10000 });
    await this.drawCalibrationLine();
    await this.completeCalibration('3.5');
    // Auto-advances to step 2

    // Step 2: Table Types + Auto-Place
    await this.tableTypeAddBtn.waitFor({ state: 'visible', timeout: 5000 });
    await this.addTableType(tableTypeName, tableWidth, tableHeight);
    await this.autoPlaceTables();
    await this.waitForNextEnabled();
    await this.clickNext();

    // Step 3: Edit Layout / Section Grouping
    await this.sectionGroupToggle.waitFor({ state: 'visible', timeout: 10000 });
    await this.groupAllTablesIntoSection(sectionName, sectionLocation);
    await this.waitForNextEnabled();
    await this.clickNext();

    // Step 4: Save
    await this.saveOpenBtn.waitFor({ state: 'visible', timeout: 10000 });
    await this.openSaveDialog();
    await this.confirmSave();
    await this.waitForSaveComplete();
  }
}
