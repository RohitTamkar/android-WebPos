export const PRODUCT_IMAGE_MAX_BYTES = 30 * 1024;
export const IMAGE_INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export interface CropRegion { x: number; y: number; size: number; width?: number; height?: number }

export function cropRegion(width: number, height: number, zoom: number, x: number, y: number): CropRegion {
  const size = Math.min(width, height) / Math.max(1, zoom);
  return { size, x: (width - size) * Math.min(1, Math.max(0, x)), y: (height - size) * Math.min(1, Math.max(0, y)) };
}

export async function decodeProductImage(file: File): Promise<ImageBitmap> {
  if (!IMAGE_INPUT_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image smaller than 30 MB.');
  // Browser decoding applies JPEG EXIF orientation before crop coordinates are calculated.
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (image.width * image.height > 40_000_000) {
    image.close(); throw new Error('This image is too large to edit. Choose an image below 40 megapixels.');
  }
  return image;
}

function encode(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob
    ? resolve(blob) : reject(new Error('Unable to process this image. Please try another image.')), type, quality));
}

export async function processProductImage(image: ImageBitmap, crop: CropRegion): Promise<File> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable in this browser.');
  const cropWidth = crop.width ?? crop.size, cropHeight = crop.height ?? crop.size;
  const longestSide = Math.max(cropWidth, cropHeight);
  const draw = (size: number) => {
    canvas.width = Math.max(1, Math.floor(size * cropWidth / longestSide));
    canvas.height = Math.max(1, Math.floor(size * cropHeight / longestSide));
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // Every candidate comes directly from the decoded original, never encoded output.
    // Honor the chosen crop or the full source proportions; retain alpha without stretching.
    context.drawImage(image, crop.x, crop.y, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  };
  const asFile = (blob: Blob) => new File([blob], `product.${blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png'}`, { type: blob.type });
  const nativeSize = Math.max(1, Math.floor(longestSide));
  draw(nativeSize);
  const originalPng = await encode(canvas);
  if (originalPng.size <= PRODUCT_IMAGE_MAX_BYTES) return asFile(originalPng);

  // Retain dimensions first, then progressively reduce by 15%. A quality floor and
  // 256px resolution floor prevent the old silent reduction to tiny thumbnails.
  // Small sources keep their native dimensions, even when they cannot fit.
  const minimumSize = Math.min(nativeSize, Math.ceil(256 * longestSide / Math.min(cropWidth, cropHeight)));
  let size = nativeSize;
  while (true) {
    if (size !== nativeSize) {
      draw(size);
      const png = await encode(canvas);
      if (png.size <= PRODUCT_IMAGE_MAX_BYTES) return asFile(png);
    }
    // WebP supports alpha. Browsers without its encoder return PNG; only opaque
    // crops may use JPEG as a fallback, so transparency never becomes black.
    let type = 'image/webp';
    let best = await encode(canvas, type, 0.8);
    if (best.type !== type) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = true;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) { opaque = false; break; }
      }
      if (opaque) { type = 'image/jpeg'; best = await encode(canvas, type, 0.8); }
    }
    if (best.type === type && best.size <= PRODUCT_IMAGE_MAX_BYTES) {
      const high = await encode(canvas, type, 0.98);
      if (high.size <= PRODUCT_IMAGE_MAX_BYTES) return asFile(high);
      let lower = 0.8, upper = 0.98;
      for (let attempt = 0; attempt < 8; attempt++) {
        const quality = (lower + upper) / 2;
        const candidate = await encode(canvas, type, quality);
        if (candidate.type === type && candidate.size <= PRODUCT_IMAGE_MAX_BYTES) { lower = quality; best = candidate; }
        else upper = quality;
      }
      return asFile(best);
    }
    if (size === minimumSize) break;
    size = Math.max(minimumSize, Math.floor(size * 0.85));
  }
  throw new Error('Unable to prepare a clear image within 30 KB. Adjust the crop or choose a simpler, clearer image.');
}
