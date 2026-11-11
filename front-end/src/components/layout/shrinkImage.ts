/**
 * A floorplan image too large to upload, shrunk in the browser before it is sent (T257).
 *
 * Production's functions take a request of at most 4.5 MB, and the upload route refuses a file
 * over `MAX_UPLOAD_BYTES` (`back-end/floorplan_limits.py`), so a photo or a PNG of a plan over it
 * is decoded, its longest side brought to at most `MAX_SIDE_PX`, and re-encoded as WebP at
 * quality 0.9, then 0.8, then at smaller sides, until it is under the limit. A PDF is not drawn
 * here: the uploader refuses one over the limit with its own sentence.
 */

/** The upload's limit, the server's `MAX_UPLOAD_BYTES`. */
export const MAX_UPLOAD_BYTES = 4_000_000;
/** The longest side a shrunk image keeps; a floorplan needs no more to be drawn sharp. */
const MAX_SIDE_PX = 8_000;
/** Below this the plan could no longer be read, so the image is refused instead. */
const MIN_SIDE_PX = 500;
const QUALITIES = [0.9, 0.8];
/** Each later try's sides, as a share of the last's. */
const STEP = 0.8;

/** An image decoded once, encoded at any size. */
export interface OpenedImage {
  width: number;
  height: number;
  encode(width: number, height: number, quality: number): Promise<Blob>;
  close(): void;
}

export type ImageCodec = (file: Blob) => Promise<OpenedImage>;

/** The image could not be brought under the limit and still be read. */
export class ImageTooLarge extends Error {}

/** The browser's own codec: a bitmap drawn on a canvas, encoded by `toBlob`. */
const browserCodec: ImageCodec = async (file) => {
  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width,
    height: bitmap.height,
    encode(width, height, quality) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return Promise.reject(new Error('No 2D canvas'));
      context.drawImage(bitmap, 0, 0, width, height);
      return new Promise<Blob>((resolve, reject) =>
        // A browser that cannot write WebP writes PNG, which the name follows.
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Not encoded'))),
          'image/webp',
          quality,
        ),
      );
    },
    close: () => bitmap.close(),
  };
};

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

function renamed(name: string, type: string): string {
  const stem = name.replace(/\.[^.]*$/, '') || 'floorplan';
  return `${stem}.${EXTENSIONS[type] ?? 'img'}`;
}

/** The file as it may be sent: itself when within the limit, else shrunk; `ImageTooLarge` when it
 * cannot be. */
export async function shrinkToUpload(file: File, open: ImageCodec = browserCodec): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const image = await open(file);
  try {
    const fit = Math.min(1, MAX_SIDE_PX / Math.max(image.width, image.height));
    let width = Math.round(image.width * fit);
    let height = Math.round(image.height * fit);
    for (const quality of QUALITIES) {
      const blob = await image.encode(width, height, quality);
      if (blob.size < MAX_UPLOAD_BYTES) return asFile(blob, file.name);
    }
    while (Math.min(width, height) * STEP >= MIN_SIDE_PX) {
      width = Math.round(width * STEP);
      height = Math.round(height * STEP);
      const blob = await image.encode(width, height, QUALITIES[QUALITIES.length - 1]);
      if (blob.size < MAX_UPLOAD_BYTES) return asFile(blob, file.name);
    }
    throw new ImageTooLarge();
  } finally {
    image.close();
  }
}

function asFile(blob: Blob, name: string): File {
  const file = new File([blob], renamed(name, blob.type), { type: blob.type });
  // A blob that only says its size (a test's) keeps saying it.
  if (file.size !== blob.size) Object.defineProperty(file, 'size', { value: blob.size });
  return file;
}
