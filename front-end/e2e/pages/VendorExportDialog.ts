import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Export vendors dialog (E42/F01/S01 and S02), wherever it opens from.
 */
export class VendorExportDialog {
  readonly page: Page;

  readonly window: Locator;
  readonly summary: Locator;
  readonly placed: Locator;
  readonly previewHeader: Locator;
  readonly previewRows: Locator;
  readonly downloadButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.window = page.getByTestId('vendor-export-window');
    this.summary = page.getByTestId('vendor-export-summary');
    this.placed = page.getByTestId('vendor-export-placed');
    this.previewHeader = page.getByTestId('vendor-export-preview-header');
    this.previewRows = page.getByTestId('vendor-export-preview-row');
    this.downloadButton = page.getByTestId('vendor-export-submit-button');
  }

  status(id: 'open' | 'follow_up' | 'approved' | 'rejected' | 'added'): Locator {
    return this.page.getByTestId(`vendor-export-status-${id}`);
  }

  /** A column's box, under its heading. */
  column(id: string): Locator {
    return this.page.getByTestId(`vendor-export-column-${id}`);
  }

  /** The heading a column is listed under (E42/F01/S02). */
  group(id: 'vendor' | 'answers' | 'assignment'): Locator {
    return this.page.getByTestId(`vendor-export-group-${id}`);
  }

  async moveUp(id: string): Promise<void> {
    await this.page.getByTestId(`vendor-export-move-up-${id}`).click();
  }

  /** Download the file and read it: its name and its text, byte-order mark and all. */
  async download(): Promise<{ filename: string; text: string }> {
    const download = this.page.waitForEvent('download');
    await this.downloadButton.click();
    const file = await download;
    return {
      filename: file.suggestedFilename(),
      text: readFileSync((await file.path()) as string, 'utf8'),
    };
  }
}
