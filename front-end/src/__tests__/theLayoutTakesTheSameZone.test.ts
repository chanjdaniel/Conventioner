// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import FloorplanUploader from '@/components/layout/FloorplanUploader.vue';

const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const shrink = vi.hoisted(() => ({ shrinkToUpload: vi.fn() }));

vi.mock('@/components/layout/shrinkImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/layout/shrinkImage')>();
  return { ...actual, shrinkToUpload: shrink.shrinkToUpload };
});

/**
 * A location's floorplan is taken on the shared drop zone (T205, F11 of the 2026-11-02 walk), as
 * the import and the start from a Google Form do, and held to the upload's limits in the browser
 * (T257 ticket 02).
 */
function fileOf(name: string, type: string, size?: number): File {
  const file = new File(['fixture'], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function choose(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.get('[data-testid="floorplan-upload-file-input"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
}

const TWO_PAGES = {
  data: {
    pages: [
      { gridfs_id: 'page-1', width: 800, height: 600 },
      { gridfs_id: 'page-2', width: 800, height: 600 },
    ],
  },
};

describe("a location's floorplan uploader", () => {
  beforeEach(() => {
    api.post.mockReset();
    api.get.mockReset();
    shrink.shrinkToUpload.mockReset();
    shrink.shrinkToUpload.mockImplementation(async (file: File) => file);
    // A PDF's preview is the page the server drew, fetched once the upload answers.
    api.get.mockResolvedValue({ data: new Blob(['page'], { type: 'image/png' }) });
    URL.createObjectURL = vi.fn(() => 'blob:fixture');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the shared drop zone, naming the files it takes and the limit', () => {
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    expect(zone.classes()).toContain('file-drop-zone');
    expect(zone.text()).toContain("Drop the floorplan's image or PDF here, or choose a file");
    expect(zone.text()).toContain('PNG, JPG, WebP or PDF, up to 4 MB');
    const input = wrapper.get('[data-testid="floorplan-upload-file-input"]');
    expect(input.attributes('accept')).toBe('image/png,image/jpeg,image/webp,application/pdf');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('uploads a chosen PNG for its market, busy while it does, then says it is in', async () => {
    let answer!: (value: unknown) => void;
    api.post.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.png', 'image/png'));
    await flushPromises();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, form] = api.post.mock.calls[0];
    expect(path).toBe('/floorplans/upload');
    expect((form as FormData).get('market_id')).toBe('market-1');
    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    expect(zone.attributes('aria-busy')).toBe('true');
    expect(wrapper.get('[data-testid="floorplan-upload-progress"]').text()).toBe('Uploading…');

    answer({ data: { gridfs_id: 'image-1', width: 800, height: 600 } });
    await flushPromises();

    expect(wrapper.emitted('uploaded')).toEqual([
      [{ gridfs_id: 'image-1', width: 800, height: 600 }],
    ]);
    expect(wrapper.find('[data-testid="floorplan-upload-progress"]').exists()).toBe(false);
  });

  it('stays busy while the caller saves what was chosen', () => {
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1', busy: true } });

    expect(wrapper.get('[data-testid="floorplan-upload-dropzone"]').attributes('aria-busy')).toBe(
      'true',
    );
  });

  it('sends an image over 4 MB as the shrink gives it back', async () => {
    const smaller = fileOf('hall.webp', 'image/webp', 3_000_000);
    shrink.shrinkToUpload.mockResolvedValue(smaller);
    api.post.mockResolvedValue({ data: { gridfs_id: 'image-1', width: 8000, height: 6000 } });
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.png', 'image/png', 5_000_000));
    await flushPromises();

    expect((api.post.mock.calls[0][1] as FormData).get('file')).toStrictEqual(smaller);
    expect(wrapper.emitted('uploaded')).toHaveLength(1);
  });

  it('refuses a PDF over 4 MB in the browser with its sentence, as an alert', async () => {
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.pdf', 'application/pdf', 4_000_001));
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    const error = wrapper.get('[data-testid="floorplan-upload-error"]');
    expect(error.attributes('role')).toBe('alert');
    expect(error.text()).toBe(
      'This PDF is larger than 4 MB. Export the page with the plan on it as a PNG or a smaller PDF.',
    );
  });

  it('takes a PDF of exactly 4 MB', async () => {
    api.post.mockResolvedValue({ data: { pages: [{ gridfs_id: 'p', width: 1, height: 1 }] } });
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.pdf', 'application/pdf', 4_000_000));
    await flushPromises();

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("uses a one-page PDF's page at once, numbered", async () => {
    api.post.mockResolvedValue({
      data: { pages: [{ gridfs_id: 'page-1', width: 1654, height: 2339 }] },
    });
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.pdf', 'application/pdf'));
    await flushPromises();

    expect(wrapper.emitted('uploaded')).toEqual([
      [{ gridfs_id: 'page-1', width: 1654, height: 2339, page: 1 }],
    ]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows a PDF of several pages as the page the server drew, and uses the page chosen', async () => {
    // A browser draws no PDF in an image, so the preview of the file itself was a broken image.
    const drawn = new Map<Blob, string>();
    api.get.mockImplementation(async (path: string) => {
      const blob = new Blob([path], { type: 'image/png' });
      drawn.set(blob, `blob:${path}`);
      return { data: blob };
    });
    URL.createObjectURL = vi.fn((blob: Blob) => drawn.get(blob) ?? 'blob:the-file');
    api.post.mockResolvedValue(TWO_PAGES);
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.pdf', 'application/pdf'));
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith('/floorplans/page-1', { responseType: 'blob' });
    expect(wrapper.get('img').attributes('src')).toBe('blob:/floorplans/page-1');
    expect(wrapper.emitted('uploaded')).toBeUndefined();

    await wrapper.findAll('.page-radio')[1].setValue();
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe('blob:/floorplans/page-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:/floorplans/page-1');
    const use = wrapper.get('[data-testid="floorplan-upload-use-page"]');
    expect(use.text()).toBe('Use page 2');
    await use.trigger('click');

    expect(wrapper.emitted('uploaded')).toEqual([
      [{ gridfs_id: 'page-2', width: 800, height: 600, page: 2 }],
    ]);
  });

  it('keeps a PDF preview on the page last chosen when an earlier page answers late', async () => {
    const held: Record<string, () => void> = {};
    const urls = new Map<Blob, string>();
    api.get.mockImplementation((path: string) => {
      const blob = new Blob([path], { type: 'image/png' });
      urls.set(blob, `blob:${path}`);
      if (path.endsWith('page-2')) {
        return new Promise((resolve) => (held[path] = () => resolve({ data: blob })));
      }
      return Promise.resolve({ data: blob });
    });
    URL.createObjectURL = vi.fn((blob: Blob) => urls.get(blob) ?? 'blob:the-file');
    api.post.mockResolvedValue(TWO_PAGES);
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });
    await choose(wrapper, fileOf('hall.pdf', 'application/pdf'));
    await flushPromises();

    await wrapper.findAll('.page-radio')[1].setValue();
    await wrapper.findAll('.page-radio')[0].setValue();
    await flushPromises();
    held['/floorplans/page-2']();
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe('blob:/floorplans/page-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:/floorplans/page-2');
  });

  it('says a PDF was uploaded when only its page could not be shown', async () => {
    api.post.mockResolvedValue(TWO_PAGES);
    api.get.mockRejectedValueOnce(new Error('offline'));
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.pdf', 'application/pdf'));
    await flushPromises();

    expect(wrapper.get('[data-testid="floorplan-upload-error"]').text()).toBe(
      'The floorplan was uploaded, but its page could not be shown. Choose the file again.',
    );
    expect(wrapper.find('[data-testid="floorplan-upload-dropzone"]').exists()).toBe(true);
    expect(wrapper.find('.page-option').exists()).toBe(false);
    expect(wrapper.emitted('uploaded')).toBeUndefined();
  });

  it('refuses a file of another type with the type sentence, as an alert, and uploads nothing', async () => {
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.txt', 'text/plain'));

    expect(api.post).not.toHaveBeenCalled();
    const error = wrapper.get('[data-testid="floorplan-upload-error"]');
    expect(error.text()).toBe('This file is not a PNG, JPG, WebP or PDF.');
    expect(error.attributes('role')).toBe('alert');
    expect(wrapper.emitted('error')).toEqual([['This file is not a PNG, JPG, WebP or PDF.']]);
    expect(wrapper.find('[data-testid="floorplan-upload-dropzone"]').exists()).toBe(true);
  });

  it("says the server's refusal as it words it, and keeps the zone for another file", async () => {
    api.post.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        isAxiosError: true,
        response: { status: 400, data: { error: 'hall.pdf could not be read as a PDF.' } },
      }),
    );
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.pdf', 'application/pdf'));
    await flushPromises();

    expect(wrapper.get('[data-testid="floorplan-upload-error"]').text()).toBe(
      'hall.pdf could not be read as a PDF.',
    );
    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    expect(zone.attributes('aria-busy')).toBeUndefined();

    api.post.mockResolvedValueOnce({ data: { gridfs_id: 'image-2', width: 800, height: 600 } });
    await choose(wrapper, fileOf('hall.png', 'image/png'));
    await flushPromises();

    expect(wrapper.find('[data-testid="floorplan-upload-error"]').exists()).toBe(false);
    expect(wrapper.emitted('uploaded')).toEqual([
      [{ gridfs_id: 'image-2', width: 800, height: 600 }],
    ]);
  });
});
