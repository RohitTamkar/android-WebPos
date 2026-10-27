import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TARGET_BYTES } from '../../../shared/productImageLimits.ts';
export { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TARGET_BYTES };

export function productImageSizeLabel(file: Blob): string {
  return `${(file.size / 1024).toFixed(2)} KB · ${file.size <= PRODUCT_IMAGE_TARGET_BYTES ? '30 KB target achieved' : 'Above 30 KB target — retained for clarity'}`;
}
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

export async function processProductImage(image: ImageBitmap, crop: CropRegion, source?: File): Promise<File> {
  if (source && source.size <= PRODUCT_IMAGE_TARGET_BYTES && crop.x === 0 && crop.y === 0
    && crop.width === image.width && crop.height === image.height && Math.max(image.width, image.height) <= 1600) return source;
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
  // Bound large camera sources without upscaling small ones. Keep at least 768px
  // on the long side (or native size) and 256px on the short side where possible.
  const initialSize = Math.min(nativeSize, 1600);
  const minimumSize = Math.min(initialSize, Math.max(768, Math.ceil(256 * longestSide / Math.min(cropWidth, cropHeight))));
  let size = initialSize;
  let clarityFallback: Blob | undefined;
  while (true) {
    draw(size);
    const png = await encode(canvas);
    if (png.size <= PRODUCT_IMAGE_TARGET_BYTES) return asFile(png);
    // WebP is already supported by the POS and storage layer and preserves alpha.
    // A missing WebP encoder may use JPEG only for opaque content.
    let type = 'image/webp';
    let preferred = await encode(canvas, type, 0.9);
    if (preferred.type !== type) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = true;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) { opaque = false; break; }
      }
      type = opaque ? 'image/jpeg' : 'image/png';
      preferred = type === 'image/png' ? png : await encode(canvas, type, 0.9);
    }
    if (preferred.size <= PRODUCT_IMAGE_TARGET_BYTES) return asFile(preferred);
    if (!clarityFallback && preferred.size <= PRODUCT_IMAGE_MAX_BYTES) clarityFallback = preferred;
    if (type !== 'image/png') {
      let best = await encode(canvas, type, 0.82);
      if (!clarityFallback && best.size <= PRODUCT_IMAGE_MAX_BYTES) clarityFallback = best;
      if (best.size <= PRODUCT_IMAGE_TARGET_BYTES) {
        let lower = 0.82, upper = 0.9;
        for (let attempt = 0; attempt < 7; attempt++) {
          const quality = (lower + upper) / 2;
          const candidate = await encode(canvas, type, quality);
          if (candidate.size <= PRODUCT_IMAGE_TARGET_BYTES) { lower = quality; best = candidate; }
          else upper = quality;
        }
        return asFile(best);
      }
    }
    if (size === minimumSize) {
      // Stop shrinking for a byte target. Keep the preferred quality and show
      // the measured size to the user before they explicitly upload it.
      if (clarityFallback) return asFile(clarityFallback);
      throw new Error('This image needs more than 512 KB to retain detail. Choose a smaller source or adjust the crop.');
    }
    size = Math.max(minimumSize, Math.floor(size * 0.85));
  }
}
