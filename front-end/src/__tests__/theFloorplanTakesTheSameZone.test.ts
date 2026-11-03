// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import FloorplanUploader from '@/components/floorplan/FloorplanUploader.vue';

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

/**
 * The floorplan uploader takes its file on the shared drop zone (T205, F11 of the 2026-11-02
 * walk), as the import and the start from a Google Form do, where it had drawn a third design
 * with a "Browse Files" button.
 */
function fileOf(name: string, type: string): File {
  return new File(['fixture'], name, { type });
}

async function choose(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.get('[data-testid="floorplan-upload-file-input"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
}

describe('the floorplan uploader', () => {
  beforeEach(() => {
    api.post.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:fixture');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the shared drop zone, naming the files it takes, and no Browse Files button', () => {
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    expect(zone.classes()).toContain('file-drop-zone');
    expect(zone.text()).toContain('Drop a floorplan image or PDF here, or choose a file');
    expect(zone.text()).toContain('PNG, JPG, WebP or PDF.');
    const input = wrapper.get('[data-testid="floorplan-upload-file-input"]');
    expect(input.attributes('accept')).toBe('image/png,image/jpeg,image/webp,application/pdf');
    expect(wrapper.text()).not.toContain('Browse Files');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('uploads a chosen PNG for its market, busy while it does, then shows its preview', async () => {
    let answer!: (value: unknown) => void;
    api.post.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.png', 'image/png'));

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, form] = api.post.mock.calls[0];
    expect(path).toBe('/floorplans/upload');
    expect((form as FormData).get('market_id')).toBe('market-1');
    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    expect(zone.attributes('aria-busy')).toBe('true');
    expect(
      wrapper.get('[data-testid="floorplan-upload-file-input"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.find('[data-testid="floorplan-upload-progress"]').exists()).toBe(true);

    answer({ data: { gridfs_id: 'image-1', width: 800, height: 600 } });
    await flushPromises();

    expect(wrapper.emitted('uploaded')).toEqual([
      [{ gridfs_id: 'image-1', width: 800, height: 600 }],
    ]);
    expect(wrapper.find('[data-testid="floorplan-upload-dropzone"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="floorplan-upload-progress"]').exists()).toBe(false);
    expect(wrapper.get('img').attributes('src')).toBe('blob:fixture');
  });

  it('uploads a dropped PDF and offers its pages', async () => {
    api.post.mockResolvedValue({
      data: {
        pages: [
          { gridfs_id: 'page-1', width: 800, height: 600, page: 1 },
          { gridfs_id: 'page-2', width: 800, height: 600, page: 2 },
        ],
      },
    });
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    await zone.trigger('drop', {
      dataTransfer: { files: [fileOf('hall.pdf', 'application/pdf')] },
    });
    await flushPromises();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('uploaded')?.[0]).toEqual([
      { gridfs_id: 'page-1', width: 800, height: 600, page: 1 },
    ]);
    expect(wrapper.findAll('.page-option')).toHaveLength(2);
  });

  it('refuses a file of another type, as before, and uploads nothing', async () => {
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.txt', 'text/plain'));

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="floorplan-upload-error"]').text()).toBe(
      'Unsupported file type. Please use PNG, JPG, WebP, or PDF.',
    );
    expect(wrapper.emitted('error')).toEqual([
      ['Unsupported file type. Please use PNG, JPG, WebP, or PDF.'],
    ]);
    expect(wrapper.find('[data-testid="floorplan-upload-dropzone"]').exists()).toBe(true);
  });

  it('keeps the zone after a failed upload, so another file can be chosen', async () => {
    api.post.mockRejectedValueOnce(new Error('offline'));
    const wrapper = mount(FloorplanUploader, { props: { marketId: 'market-1' } });

    await choose(wrapper, fileOf('hall.png', 'image/png'));
    await flushPromises();

    expect(wrapper.get('[data-testid="floorplan-upload-error"]').text()).not.toBe('');
    const zone = wrapper.get('[data-testid="floorplan-upload-dropzone"]');
    expect(zone.attributes('aria-busy')).toBeUndefined();
    expect(wrapper.find('img').exists()).toBe(false);

    api.post.mockResolvedValueOnce({ data: { gridfs_id: 'image-2', width: 800, height: 600 } });
    await choose(wrapper, fileOf('hall.png', 'image/png'));
    await flushPromises();

    expect(api.post).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="floorplan-upload-error"]').exists()).toBe(false);
    expect(wrapper.emitted('uploaded')).toEqual([
      [{ gridfs_id: 'image-2', width: 800, height: 600 }],
    ]);
  });
});
