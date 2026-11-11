import { expect, type Locator, type Page } from '@playwright/test';

/**
 * A location's layout page (T257): `/markets/:marketId/layout/:locationId`, under the Market
 * Setup tab. Its head row, the upload's drop zone, the calibration over the floorplan, and the
 * layout's drawing with the panel's list of sections.
 */
export class LayoutPage {
  readonly page: Page;
  readonly root: Locator;
  readonly locations: Locator;
  readonly saveState: Locator;
  readonly scale: Locator;
  readonly backToSetup: Locator;
  readonly uploadDropzone: Locator;
  readonly uploadFileInput: Locator;
  readonly uploadProgress: Locator;
  readonly uploadError: Locator;
  readonly usePage: Locator;
  readonly calibration: Locator;
  readonly calibrationMap: Locator;
  readonly calibrationLine: Locator;
  readonly length: Locator;
  readonly unit: Locator;
  readonly setScale: Locator;
  readonly calibrationError: Locator;
  readonly recalibrate: Locator;
  readonly image: Locator;
  readonly map: Locator;
  readonly mapImage: Locator;
  readonly tables: Locator;
  readonly sectionLabels: Locator;
  readonly zones: Locator;
  readonly sections: Locator;
  readonly editor: Locator;
  readonly stage: Locator;
  readonly toolbar: Locator;
  readonly toolSelect: Locator;
  readonly toolAdd: Locator;
  readonly toolRow: Locator;
  readonly undo: Locator;
  readonly redo: Locator;
  readonly zoomOut: Locator;
  readonly zoomIn: Locator;
  readonly fit: Locator;
  readonly zoom: Locator;
  readonly addSection: Locator;
  readonly addType: Locator;
  readonly rowGap: Locator;
  readonly rowStand: Locator;
  readonly rowFlip: Locator;
  readonly rowRows: Locator;
  readonly rowAisle: Locator;
  readonly rowSpread: Locator;
  /** The ring the path's first point wears while a click on it would close the path. */
  readonly rowClose: Locator;
  readonly rowPreview: Locator;
  readonly rowCount: Locator;
  readonly rowPoints: Locator;
  readonly rowTables: Locator;
  readonly rowLines: Locator;
  readonly rowCrosshair: Locator;
  readonly toolFill: Locator;
  /** "Fill what is in view", in Fill an area's options strip. */
  readonly fillView: Locator;
  readonly fillPreview: Locator;
  /** The box in hand, or the area closed, shaded. */
  readonly fillArea: Locator;
  readonly fillLine: Locator;
  readonly fillPoints: Locator;
  /** The ring the shape's first corner wears while a click on it would close the shape. */
  readonly fillClose: Locator;
  readonly fillCrosshair: Locator;
  /** Fill an area's dialog and its fields. */
  readonly fillDialog: Locator;
  readonly fillAreaText: Locator;
  readonly fillSection: Locator;
  readonly fillType: Locator;
  readonly fillCountChoice: Locator;
  readonly fillCount: Locator;
  readonly fillFitChoice: Locator;
  readonly fillDirection: Locator;
  readonly fillAisle: Locator;
  readonly fillInView: Locator;
  readonly fillSubmit: Locator;
  readonly fillCancel: Locator;
  readonly fillError: Locator;
  /** The panel's status line: what Fill an area did, or why an area did not close. */
  readonly status: Locator;
  readonly guides: Locator;
  readonly turnKnob: Locator;
  readonly hint: Locator;
  readonly selection: Locator;
  readonly selectionTitle: Locator;
  readonly selectionSection: Locator;
  readonly selectionType: Locator;
  readonly selectionPosition: Locator;
  readonly selectionCodes: Locator;
  readonly selectionTurn: Locator;
  readonly selectionRemove: Locator;
  readonly selectionDuplicate: Locator;
  readonly selectionAlign: Locator;
  readonly selectionRow: Locator;
  readonly selectionRowCount: Locator;
  readonly selectionRowAdd: Locator;
  readonly selectBox: Locator;
  readonly noSection: Locator;
  readonly selectNoSection: Locator;
  readonly startingCounts: Locator;
  readonly saveRetry: Locator;
  readonly saveReload: Locator;
  readonly announcement: Locator;
  readonly keyboard: Locator;
  readonly keyboardSummary: Locator;
  readonly toolZone: Locator;
  readonly zoneBox: Locator;
  readonly zonesCard: Locator;
  readonly zoneRows: Locator;
  readonly zoneLabels: Locator;
  readonly noZones: Locator;
  readonly typesCard: Locator;
  readonly typeRows: Locator;
  readonly typesSaid: Locator;
  readonly typesAdd: Locator;
  readonly typesUseSaved: Locator;
  readonly typesSave: Locator;
  readonly typeDialog: Locator;
  readonly typeName: Locator;
  readonly typeWidth: Locator;
  readonly typeDepth: Locator;
  readonly typeUnit: Locator;
  readonly typeSubmit: Locator;
  readonly typeCancel: Locator;
  readonly typeError: Locator;
  readonly savedTypesDialog: Locator;
  readonly savedTypesSubmit: Locator;
  readonly saveTypesDialog: Locator;
  readonly saveTypesName: Locator;
  readonly saveTypesSubmit: Locator;
  readonly showImage: Locator;
  readonly replaceImage: Locator;
  readonly replaceCancel: Locator;
  readonly calibrationCancel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('layout-page');
    this.locations = page.getByTestId('layout-locations');
    this.saveState = page.getByTestId('layout-save-state');
    this.scale = page.getByTestId('layout-scale');
    this.backToSetup = page.getByTestId('layout-back-to-setup');
    this.uploadDropzone = page.getByTestId('floorplan-upload-dropzone');
    this.uploadFileInput = page.getByTestId('floorplan-upload-file-input');
    this.uploadProgress = page.getByTestId('floorplan-upload-progress');
    this.uploadError = page.getByTestId('floorplan-upload-error');
    this.usePage = page.getByTestId('floorplan-upload-use-page');
    this.calibration = page.getByTestId('layout-calibration');
    this.calibrationMap = page.getByTestId('layout-calibration-map');
    this.calibrationLine = page.getByTestId('layout-calibration-line');
    this.length = page.getByTestId('layout-calibration-length');
    this.unit = page.getByTestId('layout-calibration-unit');
    this.setScale = page.getByTestId('layout-calibration-set');
    this.calibrationError = page.getByTestId('layout-calibration-error');
    this.recalibrate = page.getByTestId('layout-recalibrate');
    this.image = page.getByTestId('layout-image');
    this.map = page.getByTestId('layout-map');
    this.mapImage = this.map.getByTestId('layout-map-image');
    this.tables = this.map.getByTestId('layout-table');
    this.sectionLabels = this.map.getByTestId('layout-map-label');
    this.zones = this.map.getByTestId('layout-map-zone');
    this.sections = page.getByTestId('layout-panel-sections');
    this.editor = page.getByTestId('layout-editor');
    this.stage = page.getByTestId('layout-stage');
    this.toolbar = page.getByRole('toolbar', { name: 'Layout tools' });
    this.toolSelect = this.toolbar.getByRole('button', { name: 'Select', exact: true });
    this.toolAdd = this.toolbar.getByRole('button', { name: 'Add table', exact: true });
    this.toolRow = this.toolbar.getByRole('button', { name: 'Row of tables', exact: true });
    this.undo = this.toolbar.getByRole('button', { name: 'Undo', exact: true });
    this.redo = this.toolbar.getByRole('button', { name: 'Redo', exact: true });
    this.zoomOut = this.toolbar.getByRole('button', { name: 'Zoom out', exact: true });
    this.zoomIn = this.toolbar.getByRole('button', { name: 'Zoom in', exact: true });
    this.fit = this.toolbar.getByRole('button', { name: 'Fit', exact: true });
    this.zoom = page.getByTestId('layout-zoom');
    this.addSection = page.getByTestId('layout-add-section');
    this.addType = page.getByTestId('layout-add-type');
    this.rowGap = page.getByTestId('layout-row-gap');
    this.rowStand = page.getByTestId('layout-row-stand');
    this.rowFlip = page.getByTestId('layout-row-flip');
    this.rowRows = page.getByTestId('layout-row-rows');
    this.rowAisle = page.getByTestId('layout-row-aisle');
    this.rowSpread = page.getByTestId('layout-row-spread');
    this.rowClose = this.map.getByTestId('layout-row-close');
    this.rowPreview = this.map.getByTestId('layout-row-preview');
    this.rowCount = this.map.getByTestId('layout-row-count');
    this.rowPoints = this.map.getByTestId('layout-row-point');
    this.rowTables = this.map.getByTestId('layout-row-table');
    this.rowLines = this.map.getByTestId('layout-row-line');
    this.rowCrosshair = this.map.getByTestId('layout-row-crosshair');
    this.toolFill = this.toolbar.getByRole('button', { name: 'Fill an area', exact: true });
    this.fillView = page.getByTestId('layout-fill-view');
    this.fillPreview = this.map.getByTestId('layout-fill-preview');
    this.fillArea = this.map.getByTestId('layout-fill-area');
    this.fillLine = this.map.getByTestId('layout-fill-line');
    this.fillPoints = this.map.getByTestId('layout-fill-point');
    this.fillClose = this.map.getByTestId('layout-fill-close');
    this.fillCrosshair = this.map.getByTestId('layout-fill-crosshair');
    this.fillDialog = page.getByTestId('layout-fill-window');
    this.fillAreaText = page.getByTestId('layout-fill-area-text');
    this.fillSection = page.getByTestId('layout-fill-section');
    this.fillType = page.getByTestId('layout-fill-type');
    this.fillCountChoice = page.getByTestId('layout-fill-count-choice');
    this.fillCount = page.getByTestId('layout-fill-count');
    this.fillFitChoice = page.getByTestId('layout-fill-fit-choice');
    this.fillDirection = page.getByTestId('layout-fill-direction');
    this.fillAisle = page.getByTestId('layout-fill-aisle');
    this.fillInView = page.getByTestId('layout-fill-in-view');
    this.fillSubmit = page.getByTestId('layout-fill-submit-button');
    this.fillCancel = page.getByTestId('layout-fill-cancel-button');
    this.fillError = page.getByTestId('layout-fill-error');
    this.status = page.getByTestId('layout-status');
    this.guides = this.map.getByTestId('layout-map-guide');
    this.turnKnob = this.map.getByTestId('layout-turn-knob');
    this.hint = page.getByTestId('layout-hint');
    this.selection = page.getByTestId('layout-panel-selection');
    this.selectionTitle = page.getByTestId('layout-selection-title');
    this.selectionSection = page.getByTestId('layout-selection-section');
    this.selectionType = page.getByTestId('layout-selection-type');
    this.selectionPosition = page.getByTestId('layout-selection-position');
    this.selectionCodes = page.getByTestId('layout-selection-codes');
    this.selectionTurn = page.getByTestId('layout-selection-turn');
    this.selectionRemove = page.getByTestId('layout-selection-remove');
    this.selectionDuplicate = page.getByTestId('layout-selection-duplicate');
    this.selectionAlign = page.getByTestId('layout-selection-align-button');
    this.selectionRow = page.getByTestId('layout-selection-row');
    this.selectionRowCount = page.getByTestId('layout-selection-row-count');
    this.selectionRowAdd = page.getByTestId('layout-selection-row-add');
    this.selectBox = this.map.getByTestId('layout-select-box');
    this.noSection = page.getByTestId('layout-panel-no-section');
    this.selectNoSection = page.getByTestId('layout-panel-select-no-section');
    this.startingCounts = page.getByTestId('layout-panel-starting');
    this.saveRetry = page.getByTestId('layout-save-retry');
    this.saveReload = page.getByTestId('layout-save-reload');
    this.announcement = page.getByTestId('layout-announcement');
    this.keyboard = page.getByTestId('layout-panel-keyboard');
    this.keyboardSummary = page.getByTestId('layout-keyboard-summary');
    this.toolZone = this.toolbar.getByRole('button', { name: 'No-table zone', exact: true });
    this.zoneBox = this.map.getByTestId('layout-zone-box');
    this.zonesCard = page.getByTestId('layout-panel-zones');
    this.zoneRows = page.getByTestId('layout-panel-zone');
    this.zoneLabels = page.getByTestId('layout-zone-label');
    this.noZones = page.getByTestId('layout-panel-no-zones');
    this.typesCard = page.getByTestId('layout-panel-types');
    this.typeRows = page.getByTestId('layout-type-row');
    this.typesSaid = page.getByTestId('layout-types-said');
    this.typesAdd = page.getByTestId('layout-types-add');
    this.typesUseSaved = page.getByTestId('layout-types-use-saved');
    this.typesSave = page.getByTestId('layout-types-save');
    this.typeDialog = page.getByTestId('layout-type-window');
    this.typeName = page.getByTestId('layout-type-name');
    this.typeWidth = page.getByTestId('layout-type-width');
    this.typeDepth = page.getByTestId('layout-type-depth');
    this.typeUnit = page.getByTestId('layout-type-unit');
    this.typeSubmit = page.getByTestId('layout-type-submit-button');
    this.typeCancel = page.getByTestId('layout-type-cancel-button');
    this.typeError = page.getByTestId('layout-type-error');
    this.savedTypesDialog = page.getByTestId('layout-saved-types-window');
    this.savedTypesSubmit = page.getByTestId('layout-saved-types-submit-button');
    this.saveTypesDialog = page.getByTestId('layout-save-types-window');
    this.saveTypesName = page.getByTestId('layout-save-types-name');
    this.saveTypesSubmit = page.getByTestId('layout-save-types-submit-button');
    this.showImage = page.getByTestId('layout-show-image');
    this.replaceImage = page.getByTestId('layout-replace-image');
    this.replaceCancel = page.getByTestId('layout-replace-cancel');
    this.calibrationCancel = page.getByTestId('layout-calibration-cancel');
  }

  /** A table type's row of the Table types card, by its name. */
  typeRow(name: string): Locator {
    return this.typeRows.filter({ hasText: name });
  }

  /** Choose an item of a table type's menu, "Edit" or "Remove". */
  async chooseForType(name: string, item: 'Edit' | 'Remove'): Promise<void> {
    await this.typeRow(name)
      .getByRole('button', { name: `Edit or remove ${name}` })
      .click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
  }

  /**
   * Add or edit a table type in its dialog, sides in cm, and wait for the market's types to be
   * written and the market read again.
   */
  async typeTheType(name: string, width: string, depth: string): Promise<void> {
    await this.typeName.fill(name);
    await this.typeWidth.fill(width);
    await this.typeDepth.fill(depth);
    const written = this.page.waitForResponse(
      (response) =>
        response.url().includes('/table-types') && response.request().method() === 'PUT',
    );
    await this.typeSubmit.click();
    expect((await written).ok()).toBe(true);
    await expect(this.typeDialog).toBeHidden();
  }

  async goto(marketId: string, locationId?: string): Promise<void> {
    const path = `/markets/${encodeURIComponent(marketId)}/layout`;
    await this.page.goto(locationId ? `${path}/${encodeURIComponent(locationId)}` : path);
    await expect(this.root).toBeVisible({ timeout: 15000 });
  }

  /** The location link of the switch named `name`. */
  location(name: string): Locator {
    return this.locations.getByRole('link', { name, exact: true });
  }

  /**
   * Drag a line across the floorplan from one image point to another, in the image's pixels,
   * with the pointer, as a person does.
   */
  async drawLine(from: [number, number], to: [number, number]): Promise<void> {
    const box = await this.calibrationMap.boundingBox();
    if (!box) throw new Error('The calibration map is not drawn');
    const [width, height] = await this.calibrationMap.evaluate((svg) => {
      const view = (svg as SVGSVGElement).viewBox.baseVal;
      return [view.width, view.height];
    });
    // The image is drawn whole in the box, centred (`xMidYMid meet`).
    const scale = Math.min(box.width / width, box.height / height);
    const left = box.x + (box.width - width * scale) / 2;
    const top = box.y + (box.height - height * scale) / 2;
    const at = ([x, y]: [number, number]) => [left + x * scale, top + y * scale] as const;
    await this.page.mouse.move(...at(from));
    await this.page.mouse.down();
    await this.page.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 4 });
    await this.page.mouse.move(...at(to), { steps: 4 });
    await this.page.mouse.up();
  }

  /** A table of the map, by the name it is a button under ("Gold row 5, Standard 6 ft"). */
  table(name: string): Locator {
    return this.map.getByRole('button', { name, exact: true });
  }

  /**
   * Put the focus on the map by keyboard, as a person does from the toolbar: on the table Tab
   * stops on, or on the map itself while it has no table. With a drawing tool on, the fields of
   * its options strip stand between the toolbar and the map, and Tab passes each.
   */
  async tabToTheMap(): Promise<void> {
    await this.toolbar.locator('[tabindex="0"]').focus();
    for (let press = 0; press < 12; press += 1) {
      await this.page.keyboard.press('Tab');
      if (await this.stage.locator(':focus').count()) return;
    }
    throw new Error('Tab did not reach the map from the toolbar');
  }

  /** Move the pointer to a point of the hall, in millimetres, with no button down. */
  async hoverAt(mm: [number, number]): Promise<void> {
    const at = await this.onScreen(mm);
    await this.page.mouse.move(at.x, at.y, { steps: 3 });
  }

  /** Double-click the floor at a point of the hall, in millimetres. */
  async doubleClickAt(mm: [number, number]): Promise<void> {
    const at = await this.onScreen(mm);
    await this.page.mouse.dblclick(at.x, at.y);
  }

  /** A table's top, the shape drawn at its size and turn, and its number. */
  tableTop(name: string): Locator {
    return this.table(name).getByTestId('layout-table-top');
  }

  tableNumber(name: string): Locator {
    return this.table(name).getByTestId('layout-table-number');
  }

  /** The border a focused table draws over its own edge. */
  tableFocusBorder(name: string): Locator {
    return this.table(name).locator('[data-focus-border]');
  }

  /** A section's name on the map, the pill beside its tables. */
  sectionLabel(name: string): Locator {
    return this.sectionLabels.filter({ hasText: name });
  }

  /** A section's row of the "Sections" card, by its name. */
  sectionRow(name: string): Locator {
    return this.sections.getByTestId('layout-panel-section').filter({ hasText: name });
  }

  /** The button that opens a section's colours: its swatch, named "Gold row's colour". */
  sectionColour(name: string): Locator {
    return this.sections.getByRole('button', { name: `${name}'s colour`, exact: true });
  }

  /** A colour of the open palette, by its name ("Violet"). */
  paletteColour(name: string): Locator {
    return this.sections.getByTestId('layout-panel-palette').getByRole('button', {
      name,
      exact: true,
    });
  }

  /** Choose an item of a section's row menu, as "Renumber by position (rows across the page)". */
  async chooseForSection(name: string, item: string): Promise<void> {
    await this.sectionRow(name)
      .getByRole('button', { name: `${name}'s tables` })
      .click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
  }

  /** Choose an item of the selection card's Align menu, as "Align top". */
  async align(item: string): Promise<void> {
    await this.selectionAlign.click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
  }

  /** Click a table at its centre with Shift held, which adds it to the selection or takes it out. */
  async shiftClickAt(mm: [number, number]): Promise<void> {
    const at = await this.onScreen(mm);
    await this.page.keyboard.down('Shift');
    await this.page.mouse.click(at.x, at.y);
    await this.page.keyboard.up('Shift');
  }

  /** A no-table zone of the map, by its name ("No-table zone: Stage"). */
  zone(name: string): Locator {
    return this.map.getByRole('img', { name, exact: true });
  }

  /**
   * Where a point of the hall, in millimetres, is on the screen, and the scale it is drawn at, in
   * pixels per millimetre: read from the part of the hall the map shows, so it holds at any pan
   * and zoom.
   */
  async onScreen(mm: [number, number]): Promise<{ x: number; y: number; scale: number }> {
    const box = await this.map.boundingBox();
    if (!box) throw new Error('The map is not drawn');
    const view = await this.map.evaluate((svg) => {
      const { x, y, width, height } = (svg as SVGSVGElement).viewBox.baseVal;
      return { x, y, width, height };
    });
    // The view is drawn whole in the box, centred (`xMidYMid meet`).
    const scale = Math.min(box.width / view.width, box.height / view.height);
    return {
      x: box.x + (box.width - view.width * scale) / 2 + (mm[0] - view.x) * scale,
      y: box.y + (box.height - view.height * scale) / 2 + (mm[1] - view.y) * scale,
      scale,
    };
  }

  /** Click the floor at a point of the hall, in millimetres. */
  async clickAt(mm: [number, number]): Promise<void> {
    const at = await this.onScreen(mm);
    await this.page.mouse.click(at.x, at.y);
  }

  /**
   * Press at one point of the hall and drag to another, in millimetres, with the pointer, as a
   * person does; `hold` runs while the button is still down, and `nudgePx` ends the drag that many
   * screen pixels past the point.
   */
  async drag(
    from: [number, number],
    to: [number, number],
    options: { hold?: () => Promise<void>; nudgePx?: [number, number] } = {},
  ): Promise<void> {
    const start = await this.onScreen(from);
    const end = await this.onScreen(to);
    const [nudgeX, nudgeY] = options.nudgePx ?? [0, 0];
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
    await this.page.mouse.move(end.x + nudgeX, end.y + nudgeY, { steps: 4 });
    await options.hold?.();
    await this.page.mouse.up();
  }

  /**
   * Do something that changes the layout, and wait for the save it starts to be answered and the
   * page to say so. The wait is for the write itself: a change waits 600 ms before it is sent.
   */
  async saved(change: () => Promise<void>): Promise<void> {
    const answered = this.page.waitForResponse(
      (response) =>
        response.url().includes('/floorplans/save-to-market') &&
        response.request().method() === 'POST',
    );
    await change();
    expect((await answered).ok()).toBe(true);
    await expect(this.saveState).toHaveText('Saved');
  }

  /**
   * Draw a shape for Fill an area: a click on each corner, in millimetres of the hall, then one
   * on the first again, which closes it.
   */
  async drawShape(corners: [number, number][]): Promise<void> {
    for (const corner of corners) await this.clickAt(corner);
    await this.hoverAt(corners[0]);
    await this.clickAt(corners[0]);
  }

  /** Set the scale: the line drawn, then its length typed in `unit`. */
  async calibrate(from: [number, number], to: [number, number], length: string, unit = 'm') {
    await this.drawLine(from, to);
    await this.length.fill(length);
    await this.unit.selectOption(unit);
    await this.setScale.click();
  }
}
