import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Export vendors dialog (E42/F01/S01 to S05), wherever it opens from.
 */
export class VendorExportDialog {
  readonly page: Page;

  readonly window: Locator;
  /** What scrolls: the filters and the columns. */
  readonly body: Locator;
  /** What is pinned above the buttons: the cart. */
  readonly tray: Locator;
  readonly summary: Locator;
  readonly placed: Locator;
  readonly mine: Locator;
  /** Paid or not, Owes, Paid in full, Paid more than owed (S04). */
  readonly payment: Locator;
  /** The chosen columns in the cart, in the file's order. */
  readonly orderRows: Locator;
  /** Their names, with each row's buttons left out. */
  readonly orderLabels: Locator;
  readonly preview: Locator;
  readonly previewHeader: Locator;
  readonly previewRows: Locator;
  /** Show the file, on a phone. */
  readonly cartToggle: Locator;
  readonly cancelButton: Locator;
  readonly downloadButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.window = page.getByTestId('vendor-export-window');
    this.body = page.getByTestId('vendor-export-body');
    this.tray = page.getByTestId('vendor-export-tray');
    this.summary = page.getByTestId('vendor-export-summary');
    this.placed = page.getByTestId('vendor-export-placed');
    this.mine = page.getByTestId('vendor-export-mine');
    this.payment = page.getByTestId('vendor-export-payment');
    this.orderRows = page.getByTestId('vendor-export-order-row');
    this.orderLabels = page.getByTestId('vendor-export-order-label');
    this.preview = page.getByTestId('vendor-export-preview');
    this.previewHeader = page.getByTestId('vendor-export-preview-header');
    this.previewRows = page.getByTestId('vendor-export-preview-row');
    this.cartToggle = page.getByTestId('vendor-export-cart-toggle');
    this.cancelButton = page.getByTestId('vendor-export-cancel-button');
    this.downloadButton = page.getByTestId('vendor-export-submit-button');
  }

  status(id: 'open' | 'follow_up' | 'approved' | 'rejected' | 'added'): Locator {
    return this.page.getByTestId(`vendor-export-status-${id}`);
  }

  /** A Discord state's box, offered once a check has run (E42/F01/S05). */
  discordState(
    id: 'has_role' | 'in_server' | 'possible_match' | 'not_found' | 'no_username' | 'check_again',
  ): Locator {
    return this.page.getByTestId(`vendor-export-discord-${id}`);
  }

  /** A column's box, under its heading. */
  column(id: string): Locator {
    return this.page.getByTestId(`vendor-export-column-${id}`);
  }

  /** The heading a column is listed under (E42/F01/S02, its money S04, its Discord S05). */
  group(id: 'vendor' | 'answers' | 'assignment' | 'payment' | 'discord'): Locator {
    return this.page.getByTestId(`vendor-export-group-${id}`);
  }

  /** A chosen column's move buttons, on its row in the cart. */
  moveDownButton(id: string): Locator {
    return this.page.getByTestId(`vendor-export-order-down-${id}`);
  }

  async moveUp(id: string): Promise<void> {
    await this.page.getByTestId(`vendor-export-order-up-${id}`).click();
  }

  /** Takes a column out from the cart. */
  removeButton(id: string): Locator {
    return this.page.getByTestId(`vendor-export-remove-${id}`);
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
