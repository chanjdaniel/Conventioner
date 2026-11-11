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

  /** A no-table zone of the map, by its name ("No-table zone: Stage"). */
  zone(name: string): Locator {
    return this.map.getByRole('img', { name, exact: true });
  }

  /** Set the scale: the line drawn, then its length typed in `unit`. */
  async calibrate(from: [number, number], to: [number, number], length: string, unit = 'm') {
    await this.drawLine(from, to);
    await this.length.fill(length);
    await this.unit.selectOption(unit);
    await this.setScale.click();
  }
}
