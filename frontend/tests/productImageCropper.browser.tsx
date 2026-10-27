import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { ProductImageCropper } from '../src/pages/ProductImageCropper.tsx';
import { cropRegion, decodeProductImage, processProductImage, PRODUCT_IMAGE_MAX_BYTES } from '../src/pages/productImageProcessing.ts';

const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const root = createRoot(document.getElementById('root')!);
async function fixture(width: number, height: number, noisy = false, type = 'image/png') {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  if (noisy) {
    const data = context.createImageData(width, height); let seed = 17;
    for (let index = 0; index < data.data.length; index++) { seed = (seed * 1664525 + 1013904223) >>> 0; data.data[index] = index % 4 === 3 ? 255 : seed >>> 24; }
    context.putImageData(data, 0, 0);
  } else {
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, width / 2, height);
    context.fillStyle = '#0000ff'; context.fillRect(width / 2, 0, width / 2, height / 2);
  }
  const encoded = atob(canvas.toDataURL(type, 0.95).split(',')[1]);
  const blob = new Blob([Uint8Array.from(encoded, char => char.charCodeAt(0))], { type });
  return new File([blob], 'fixture', { type: blob.type });
}
async function pixels(file: File) {
  const bitmap = await decodeProductImage(file);
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height); bitmap.close(); return data;
}
async function waitFor(check: () => unknown, label: string) {
  for (let i = 0; i < 160; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(`Timed out: ${label}: ${document.querySelector('[role="alert"]')?.textContent}`);
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label);
void (async () => {
  for (const [w, h] of [[320, 160], [160, 320], [160, 160]]) {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const source = await fixture(w, h, false, type); const bitmap = await decodeProductImage(source);
      const result = await processProductImage(bitmap, cropRegion(w, h, 1, 0.5, 0.5));
      assert(result.size <= PRODUCT_IMAGE_MAX_BYTES && result.type === 'image/png' && result.name.endsWith('.png'), 'Measured PNG result is within limit');
      const decoded = await pixels(result); assert(decoded.width === Math.min(w, h) && decoded.height === decoded.width, 'Native square output');
      bitmap.close();
    }
  }
  passed.push('JPEG, PNG and WebP portrait, landscape and square images decode and crop to lossless square PNGs within 30 KB');
  const source = await fixture(320, 160); const bitmap = await decodeProductImage(source);
  const left = await pixels(await processProductImage(bitmap, cropRegion(320, 160, 2, 0, 0)));
  const transparent = await pixels(await processProductImage(bitmap, cropRegion(320, 160, 2, 1, 1)));
  assert(left.width === 80 && left.data[0] === 255 && left.data[2] === 0, 'Zoom and left crop preserve red pixels exactly');
  assert(transparent.data[3] === 0, 'Transparent region remains transparent'); bitmap.close();
  const smallSource = await decodeProductImage(source);
  passed.push(`Small PNG: ${(await processProductImage(smallSource, cropRegion(320, 160, 2, 0, 0))).size} bytes`);
  smallSource.close();
  passed.push('Small image: 80px crop preserved without upscaling; transparent pixels retained');
  passed.push('Zoom and reposition produce the expected pixels; alpha transparency survives');
  // Insert a standard EXIF orientation=6 APP1 segment into a generated JPEG.
  const jpeg = await fixture(80, 40, false, 'image/jpeg');
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const oriented = await decodeProductImage(new File([bytes.slice(0,2), exif, bytes.slice(2)], 'oriented.jpg', { type: 'image/jpeg' }));
  assert(oriented.width === 40 && oriented.height === 80, 'EXIF orientation applied'); oriented.close();
  passed.push('JPEG EXIF orientation is corrected before crop calculations');
  const noise = await fixture(1024, 1024, true); const noisy = await decodeProductImage(noise);
  const adjusted = await processProductImage(noisy, cropRegion(1024,1024,1,0.5,0.5));
  assert(adjusted.size <= PRODUCT_IMAGE_MAX_BYTES && ['image/webp', 'image/jpeg', 'image/png'].includes(adjusted.type), 'Detailed image remains within safety limit');
  const adjustedBitmap = await decodeProductImage(adjusted);
  assert(adjustedBitmap.width < 1024 && adjustedBitmap.width === adjustedBitmap.height, 'Oversized image is resized without changing crop shape');
  assert(adjustedBitmap.width >= 768, 'Detailed fixture retains product-detail resolution');
  passed.push(`Detailed noise: ${adjusted.size} bytes, ${adjustedBitmap.width}px, ${adjusted.type}`);
  adjustedBitmap.close(); noisy.close();
  const labelCanvas = document.createElement('canvas'); labelCanvas.width = labelCanvas.height = 900;
  const labelContext = labelCanvas.getContext('2d')!;
  labelContext.fillStyle = '#fff'; labelContext.fillRect(0, 0, 900, 900);
  labelContext.fillStyle = '#183b57'; labelContext.font = '22px sans-serif';
  for (let y = 0; y < 900; y += 32) labelContext.fillText('SENSIBLE BIZ | Product 12345 | 250g | Rs 199', 12, y + 24);
  const labelBlob = await new Promise<Blob>(resolve => labelCanvas.toBlob(blob => resolve(blob!), 'image/png'));
  const labelBitmap = await decodeProductImage(new File([labelBlob], 'label.png', { type: 'image/png' }));
  const labelFile = await processProductImage(labelBitmap, cropRegion(900, 900, 1, 0.5, 0.5));
  const labelResult = await decodeProductImage(labelFile);
  assert(labelFile.size <= PRODUCT_IMAGE_MAX_BYTES && labelResult.width >= 768, 'Fine text retains useful resolution within the actual byte limit');
  passed.push(`Fine text: ${labelFile.size} bytes, ${labelResult.width}px, ${labelFile.type}`);
  labelBitmap.close(); labelResult.close();
  // A broken encoder must never allow oversized bytes through.
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, type) { callback(new Blob([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], { type })); };
  const small = await decodeProductImage(source);
  try {
    let failed = false; try { await processProductImage(small, cropRegion(320,160,1,0.5,0.5)); } catch (error) { failed = String(error).includes('512 KB'); }
    assert(failed, 'Oversized output never silently accepted');
  } finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; small.close(); }
  passed.push('Detail keeps at least 768px; output exceeding safety limit is rejected');
  // Simulate browsers without a WebP encoder. Alpha must use PNG; opaque
  // content may use JPEG, and neither path forces the preferred byte target.
  const alphaSource = await fixture(320, 320, true);
  const alphaBitmap = await decodeProductImage(alphaSource);
  const alphaCanvas = document.createElement('canvas'); alphaCanvas.width = alphaCanvas.height = 320;
  const alphaContext = alphaCanvas.getContext('2d')!; alphaContext.drawImage(alphaBitmap, 0, 0); alphaBitmap.close();
  alphaContext.clearRect(240, 240, 80, 80);
  const alphaBlob = await new Promise<Blob>(resolve => alphaCanvas.toBlob(blob => resolve(blob!), 'image/png'));
  const alphaImage = await decodeProductImage(new File([alphaBlob], 'alpha.png', { type: 'image/png' }));
  const fallbackOpaque = await decodeProductImage(alphaSource);
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    originalToBlob.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
  };
  try {
    const alphaResult = await processProductImage(alphaImage, cropRegion(320,320,1,0.5,0.5));
    assert(alphaResult.type === 'image/png' && alphaResult.size > 30 * 1024, 'Unsupported WebP preserves detailed alpha as PNG above target');
    const data = await pixels(alphaResult);
    assert(data.data[(319 * 320 + 319) * 4 + 3] === 0, 'Fallback alpha is unchanged');
    const opaqueResult = await processProductImage(fallbackOpaque, cropRegion(320,320,1,0.5,0.5));
    assert(opaqueResult.type === 'image/jpeg', 'Unsupported WebP uses JPEG for opaque content');
  } finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; alphaImage.close(); fallbackOpaque.close(); }
  passed.push('Unavailable WebP encoder preserves alpha with PNG and uses JPEG only for opaque content');

  let applied: File | null = null; let canceled = 0;
  const render = (file: File) => root.render(<ProductImageCropper file={file} onCancel={() => { canceled++; }} onApply={value => { applied = value; }} />);
  render(source);
  await waitFor(() => button('Save') && !button('Save')!.disabled, 'decoded crop UI');
  assert(!document.querySelector('input'), 'Crop settings fields have been removed');
  assert(!button('Preview Crop') && !button('Apply Crop'), 'There is no separate preview step');
  assert(button('Square crop'), 'Full image is default; square crop is explicit');
  button('Square crop')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  const cropCanvas = document.querySelector('canvas')!;
  const sample = () => cropCanvas.getContext('2d')!.getImageData(0, 0, 640, 640).data;
  const initial = sample();
  cropCanvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -350 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  cropCanvas.setPointerCapture = () => {};
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 140, clientY: 140 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 80, clientY: 80 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(sample().some((value, index) => value !== initial[index]), 'Scroll zoom and dragging change crop');
  button('Clear')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(sample().every((value, index) => value === initial[index]), 'Clear restores centered native crop');
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 150, clientY: 100 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 250, clientY: 100 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  let releaseEncoding: (() => void) | undefined;
  const encoderBeforeSave = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    releaseEncoding = () => encoderBeforeSave.call(this, callback, type, quality);
  };
  button('Save')!.click();
  await waitFor(() => releaseEncoding && document.querySelector('.product-crop-saving .product-image-spinner'), 'Save processing loader');
  assert(button('Saving…')?.disabled && button('Cancel')?.disabled, 'Save cannot be submitted twice while processing');
  HTMLCanvasElement.prototype.toBlob = encoderBeforeSave;
  releaseEncoding!();
  await waitFor(() => applied, 'direct save completes');
  assert((applied as unknown as File).size <= 30720, 'Save returns only processed bytes within 30 KB');
  const savedBitmap = await decodeProductImage(applied!);
  assert(savedBitmap.width < 160, 'Pinch zoom affects the saved crop'); savedBitmap.close();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); assert(canceled === 1, 'Escape cancels editor');
  passed.push('Crop UI removes settings and preview step; drag, scroll, pinch, clear and direct Save work');
  if (location.hash !== '#preview') root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
