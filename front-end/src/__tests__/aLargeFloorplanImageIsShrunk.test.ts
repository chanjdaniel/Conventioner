/**
 * A floorplan photo or PNG over the upload's 4 MB is shrunk in the browser before it is sent
 * (T257 ticket 02): its longest side to at most 8,000 px, re-encoded as WebP at quality 0.9, then
 * 0.8, then at smaller sides, until it is under the limit.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  shrinkToUpload,
  type OpenedImage,
  type ImageCodec,
} from '@/components/layout/shrinkImage';

/** A blob that says it weighs `size` bytes, so a test need not allocate megabytes. */
function sized(size: number, type: string): Blob {
  return Object.defineProperty(new Blob(['x'], { type }), 'size', { value: size });
}

type Encoded = { width: number; height: number; quality: number };

/** A codec whose output weighs `bytesPerPixel` times the pixels, scaled by the quality. */
function codec(width: number, height: number, bytesPerPixel: number) {
  const tried: Encoded[] = [];
  let closed = false;
  const open: ImageCodec = async () => {
    const opened: OpenedImage = {
      width,
      height,
      async encode(w, h, quality) {
        tried.push({ width: w, height: h, quality });
        return sized(Math.round(w * h * bytesPerPixel * quality), 'image/webp');
      },
      close() {
        closed = true;
      },
    };
    return opened;
  };
  return { open, tried, wasClosed: () => closed };
}

function fileOf(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('a floorplan image on its way up', () => {
  it('is sent as it is when it is within the limit', async () => {
    const { open, tried } = codec(4000, 3000, 1);
    const file = fileOf('hall.png', 'image/png', MAX_UPLOAD_BYTES);

    expect(await shrinkToUpload(file, open)).toBe(file);
    expect(tried).toEqual([]);
  });

  it('is re-encoded as WebP at 0.9 when that is enough, keeping its sides', async () => {
    const { open, tried, wasClosed } = codec(4000, 3000, 0.3);

    const shrunk = await shrinkToUpload(fileOf('hall.png', 'image/png', 9_000_000), open);

    expect(tried).toEqual([{ width: 4000, height: 3000, quality: 0.9 }]);
    expect(shrunk.name).toBe('hall.webp');
    expect(shrunk.type).toBe('image/webp');
    expect(shrunk.size).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(wasClosed()).toBe(true);
  });

  it('brings a longest side over 8,000 px down to 8,000 first', async () => {
    const { open, tried } = codec(16000, 4000, 0.1);

    await shrinkToUpload(fileOf('hall.jpg', 'image/jpeg', 9_000_000), open);

    expect(tried[0]).toEqual({ width: 8000, height: 2000, quality: 0.9 });
  });

  it('tries 0.8, then smaller sides, until it is under the limit', async () => {
    const { open, tried } = codec(4000, 3000, 0.5);

    const shrunk = await shrinkToUpload(fileOf('hall.png', 'image/png', 9_000_000), open);

    expect(tried.map((t) => t.quality)).toEqual([0.9, 0.8, ...tried.slice(2).map(() => 0.8)]);
    expect(tried.length).toBeGreaterThan(2);
    for (let i = 3; i < tried.length; i++) {
      expect(tried[i].width).toBeLessThan(tried[i - 1].width);
    }
    expect(shrunk.size).toBeLessThan(MAX_UPLOAD_BYTES);
    const last = tried.at(-1)!;
    expect(last.width / last.height).toBeCloseTo(4000 / 3000, 2);
  });

  it('names the file by what the browser encoded, as a browser that cannot write WebP gives PNG', async () => {
    const open: ImageCodec = async () => ({
      width: 2000,
      height: 1000,
      async encode() {
        return sized(1000, 'image/png');
      },
      close() {},
    });

    const shrunk = await shrinkToUpload(fileOf('Venue plan.jpeg', 'image/jpeg', 9_000_000), open);

    expect(shrunk.name).toBe('Venue plan.png');
    expect(shrunk.type).toBe('image/png');
  });
});
