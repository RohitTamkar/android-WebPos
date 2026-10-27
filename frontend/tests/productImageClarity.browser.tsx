import '../src/index.css';
import { decodeProductImage, processProductImage, PRODUCT_IMAGE_TARGET_BYTES, PRODUCT_IMAGE_MAX_BYTES, productImageSizeLabel } from '../src/pages/productImageProcessing.ts';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const measurements: unknown[] = [];
const results = document.getElementById('test-results')!;
const gallery = document.getElementById('root')!;
gallery.innerHTML = '<h1>Product image clarity</h1><p>Original / processed, displayed at 320px. Checkerboard indicates transparency.</p>';
const style = document.createElement('style');
style.textContent = 'body{font:16px sans-serif;background:#eee;color:#111}article{display:inline-block;vertical-align:top;width:680px;margin:8px;background:white;padding:12px}img{width:320px;height:240px;object-fit:contain;background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/16px 16px;margin:4px}';
document.head.append(style);
async function file(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), type, 0.94));
  return new File([blob], 'source', { type: blob.type });
}
void (async () => {
  for (const [name, width, height, type, detail, alpha] of [
    ['Landscape label', 1200, 800, 'image/jpeg', false, false],
    ['Portrait transparent', 800, 1200, 'image/png', false, true],
    ['Detailed texture', 1024, 1024, 'image/png', true, false],
    ['WebP label', 900, 600, 'image/webp', false, false],
    ['Small source', 160, 80, 'image/jpeg', false, false],
    ['Wide label', 1600, 400, 'image/png', false, false],
  ] as const) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    if (detail) {
      const pixels = ctx.createImageData(width, height); let seed = 13;
      for (let i = 0; i < pixels.data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
      }
      ctx.putImageData(pixels, 0, 0);
    } else {
      ctx.fillStyle = '#f9edcc'; ctx.fillRect(alpha ? width / 4 : 0, 0, alpha ? width / 2 : width, height);
      ctx.fillStyle = '#176344'; ctx.fillRect(width * .3, height * .1, width * .4, height * .8);
    }
    ctx.fillStyle = '#fff'; ctx.fillRect(width * .25, height * .35, width * .5, height * .3);
    ctx.fillStyle = '#142820'; ctx.font = `bold ${Math.max(12, width / 25)}px sans-serif`;
    ctx.fillText('TEA 250g', width * .28, height * .48);
    ctx.font = `${Math.max(10, width / 40)}px sans-serif`; ctx.fillText('Rs 199 | Batch 123', width * .28, height * .57);
    const source = await file(canvas, type);
    const bitmap = await decodeProductImage(source);
    const crop = { x: 0, y: 0, size: Math.max(width, height), width, height };
    const processed = await processProductImage(bitmap, crop, source);
    const output = await decodeProductImage(processed);
    assert(Math.abs(output.width / output.height - width / height) < .005, `${name}: aspect ratio preserved`);
    assert(output.width <= width && output.height <= height, `${name}: never upscaled`);
    assert(Math.max(output.width, output.height) >= Math.min(768, Math.max(width, height)), `${name}: detail resolution retained`);
    assert(processed.size <= PRODUCT_IMAGE_MAX_BYTES, 'Safety bound');
    if (detail) assert(processed.size > PRODUCT_IMAGE_TARGET_BYTES, 'Detailed image is permitted to exceed target for clarity');
    if (source.size <= PRODUCT_IMAGE_TARGET_BYTES) assert(processed === source, 'Small original is reused byte-for-byte');
    const decoded = document.createElement('canvas'); decoded.width = output.width; decoded.height = output.height;
    const dctx = decoded.getContext('2d')!; dctx.drawImage(output, 0, 0);
    if (alpha) assert(dctx.getImageData(0, 0, 1, 1).data[3] === 0, 'Transparent corners preserved');
    // Compare at the normal 320px display size, including both source and encoded
    // detail. This catches severe blur or lost labels without testing encoder internals.
    function display(image: ImageBitmap) {
      const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * height / width);
      const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(image, 0, 0, c.width, c.height);
      return x.getImageData(0, 0, c.width, c.height).data;
    }
    const a = display(bitmap), b = display(output); let squared = 0;
    for (let i = 0; i < a.length; i++) squared += (a[i] - b[i]) ** 2;
    const rmse = Math.sqrt(squared / a.length);
    assert(rmse < 25, `${name}: excessive normal-display distortion (${rmse})`);
    measurements.push({ name, inputBytes: source.size, outputBytes: processed.size, dimensions: `${output.width}x${output.height}`, format: processed.type, displayRmse: Number(rmse.toFixed(2)), target: processed.size <= PRODUCT_IMAGE_TARGET_BYTES });
    const article = document.createElement('article');
    const heading = document.createElement('h2'); heading.textContent = name; article.append(heading);
    for (const f of [source, processed]) { const img = document.createElement('img'); img.src = URL.createObjectURL(f); article.append(img); }
    const caption = document.createElement('p'); caption.textContent = `${source.size} → ${processed.size} bytes · ${output.width}×${output.height} · ${productImageSizeLabel(processed)}`; article.append(caption); gallery.append(article);
    bitmap.close(); output.close();
  }
  results.textContent = JSON.stringify({ passed: ['Proportions, transparency, reuse, detail floor, byte target fallback, and normal-display distortion'], measurements });
})().catch(error => { results.textContent = JSON.stringify({ failed: String(error), measurements }); });
