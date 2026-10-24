import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import { cropRegion, decodeProductImage, processProductImage } from './productImageProcessing.ts';
import './ProductImageCropper.css';

export function ProductImageCropper({ file, onCancel, onApply, onError }: {
  file: File; onCancel: () => void; onApply: (file: File) => void; onError?: (message: string) => void;
}) {
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const saving = useRef(false);
  const active = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); event.preventDefault(); if (!saving.current) onCancel(); }
      if (event.key === 'Tab') {
        const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), canvas[tabindex]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); previous?.focus(); };
  }, [onCancel]);
  useEffect(() => {
    let active = true; let decoded: ImageBitmap | undefined;
    void decodeProductImage(file).then(value => { decoded = value; if (active) setImage(value); else value.close(); })
      .catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; decoded?.close(); };
  }, [file]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !image) return;
    const context = target.getContext('2d')!;
    const crop = cropRegion(image.width, image.height, zoom, position.x, position.y);
    context.clearRect(0, 0, 640, 640);
    context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 640, 640);
  }, [image, zoom, position]);
  const prepare = async () => {
    if (!image || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      // Let React paint the loader before rendering and encoding the crop.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!active.current) return;
      const processed = await processProductImage(image, cropRegion(image.width, image.height, zoom, position.x, position.y));
      if (active.current) onApply(processed);
    }
    catch (reason) {
      if (active.current) {
        const message = (reason as Error).message;
        if (onError) onError(message); else setError(message);
      }
    }
    finally { saving.current = false; if (active.current) setBusy(false); }
  };
  return createPortal(<div className="product-crop-backdrop" onClick={event => event.stopPropagation()}>
    <div ref={panel} className="product-crop-dialog" aria-busy={busy} role="dialog" aria-modal="true" aria-labelledby="product-crop-title" tabIndex={-1}>
      <h3 id="product-crop-title">Crop product image</h3>
      <p id="product-crop-help">Drag to reposition. Scroll or pinch to zoom.</p>
      <div className="product-crop-stage">
        <canvas ref={canvas} width={640} height={640} aria-label="Square crop preview" aria-describedby="product-crop-help" tabIndex={0}
          onWheel={event => { if (!saving.current) setZoom(value => Math.max(1, Math.min(5, value * Math.exp(-event.deltaY * 0.002)))); }}
          onKeyDown={event => {
            if (saving.current) return;
            if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
            if (event.key === '+' || event.key === '=') setZoom(value => Math.min(5, value + 0.1));
            if (event.key === '-') setZoom(value => Math.max(1, value - 0.1));
            if (event.key.startsWith('Arrow')) setPosition(value => ({ x: Math.max(0, Math.min(1, value.x + (event.key === 'ArrowLeft' ? -0.02 : event.key === 'ArrowRight' ? 0.02 : 0))),
              y: Math.max(0, Math.min(1, value.y + (event.key === 'ArrowUp' ? -0.02 : event.key === 'ArrowDown' ? 0.02 : 0))) }));
          }}
          onPointerDown={event => {
            if (saving.current) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom }; drag.current = null;
            } else drag.current = { x: event.clientX, y: event.clientY, px: position.x, py: position.y };
          }}
          onPointerUp={event => { pointers.current.delete(event.pointerId); drag.current = null; pinch.current = null; }}
          onPointerCancel={event => { pointers.current.delete(event.pointerId); drag.current = null; pinch.current = null; }}
          onPointerMove={event => {
            if (saving.current) return;
            if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2 && pinch.current) {
              const [a, b] = [...pointers.current.values()];
              setZoom(Math.max(1, Math.min(5, pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance))); return;
            }
            if (!drag.current || !image) return;
            const size = Math.min(image.width, image.height) / zoom;
            const scale = event.currentTarget.getBoundingClientRect().width / size;
            setPosition({ x: Math.max(0, Math.min(1, drag.current.px - (event.clientX - drag.current.x) / (Math.max(1, image.width - size) * scale))),
              y: Math.max(0, Math.min(1, drag.current.py - (event.clientY - drag.current.y) / (Math.max(1, image.height - size) * scale))) });
          }} />
        <span className="product-crop-corners" aria-hidden="true" />
      </div>
      {busy && <div className="product-crop-saving" role="status"><LoaderCircle className="product-image-spinner" size={28} aria-hidden="true" /><span>Saving image…</span></div>}
      {error && <p className="local-image-error" role="alert">{error}</p>}
      <div className="product-crop-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setZoom(1); setPosition({ x: 0.5, y: 0.5 }); setError(''); }}>Clear</button>
        <button type="button" className="btn-primary-add" disabled={!image || busy} onClick={() => void prepare()}>{busy ? <><LoaderCircle className="product-image-spinner" size={16} aria-hidden="true" />Saving…</> : 'Save'}</button>
      </div>
    </div>
  </div>, document.body);
}
