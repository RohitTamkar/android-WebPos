import { useSuccessDismiss } from '../utils/useTimedNotice.ts';
import { productImageSizeLabel } from './productImageProcessing.ts';
import { useEffect, useRef, useState } from 'react';
import { createRequestId } from '../utils/requestId.ts';
import { ProductImageCropper } from './ProductImageCropper.tsx';
import { decodeProductImage, processProductImage } from './productImageProcessing.ts';
import { assignProductImage } from './productImageAssignmentApi.ts';
import { conflictingProducts, imageCandidates, imageTarget, MAX_BATCH_IMAGES, needsReplacement, normalizedImageName,
  readImageZip, runImageWorkers, type ImageProduct, type ImageResult, type ImageTarget } from './productImageBatch.ts';
import './ProductImageBatch.css';
import './CategoryPage.css';
import './DeleteConfirmation.css';

interface Row {
  id: string; original: File; processed: File | null; included: boolean; targets: string[]; confirmed: string[];
  status: 'preparing' | 'ready' | 'uploading' | 'complete' | 'failed'; error: string; warning: string;
  requestId: string; approved?: ImageTarget[]; results: ImageResult[];
}

function ProcessedPreview({ file }: { file: File }) {
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(file);
    if (preview.current) preview.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return <img ref={preview} className="batch-image-preview" alt="Processed upload preview" />;
}

const productName = (product: ImageProduct) => String(product.fields.name ?? 'Unnamed product');
const productLabel = (product: ImageProduct) => `${productName(product)}${product.fields.code === undefined ? '' : ` · Code ${String(product.fields.code)}`}`;
const statusLabel = (status: Row['status'] | ImageResult['status']) => ({ preparing: 'Preparing', ready: 'Ready', uploading: 'Uploading', complete: 'Complete', failed: 'Failed', saved: 'Complete', unchanged: 'Complete' })[status];

export function ProductImageBatch({ mode, products, outletId, token, imageGrant, onClose, onSaved, onSessionExpired }: {
  mode: 'bulk' | 'shared'; products: ImageProduct[]; outletId: string; token: string; imageGrant: string;
  onClose: () => void; onSaved: (documentId: string, image: string) => void; onSessionExpired: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cropId, setCropId] = useState<string | null>(null);
  const alive = useRef(true), busy = useRef(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (id: string, patch: Partial<Row>) => {
    if (alive.current) {
      setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
      if (patch.status === 'failed' || patch.targets?.length === 0) setReviewOpen(true);
    }
  };
  const load = async (file?: File) => {
    if (!file || busy.current) return;
    busy.current = true; setLoading(true); setError(''); setRows([]);
    try {
      const files = mode === 'bulk' ? await readImageZip(file) : [file];
      if (!alive.current) return;
      const counts = new Map<string, number>();
      files.forEach(item => { const name = normalizedImageName(item.name); counts.set(name, (counts.get(name) ?? 0) + 1); });
      const prepared: Row[] = files.map(original => {
        const candidates = imageCandidates(original.name, products);
        const duplicate = counts.get(normalizedImageName(original.name))! > 1;
        return { id: createRequestId(), original, processed: null, included: true,
          targets: !duplicate && candidates.length === 1 ? [candidates[0]!.documentId] : [], confirmed: [], status: 'preparing', error: '',
          warning: duplicate ? 'Duplicate filename: choose a product manually or exclude this image.'
            : candidates.length > 1 ? 'Ambiguous name: choose a product explicitly.' : candidates.length === 0 ? 'No exact match: choose products manually.' : '',
          requestId: createRequestId(), results: [] };
      });
      setRows(prepared);
      setReviewOpen(mode === 'shared' || prepared.some(row => row.warning || row.targets.some(id => products.some(product => product.documentId === id && needsReplacement(product)))));
      // Decode one source at a time; retain only the original files and small output blobs.
      for (const row of prepared) {
        if (!alive.current) return;
        let bitmap: ImageBitmap | undefined;
        try {
          bitmap = await decodeProductImage(row.original);
          const processed = await processProductImage(bitmap, { x: 0, y: 0, size: Math.max(bitmap.width, bitmap.height), width: bitmap.width, height: bitmap.height }, row.original);
          update(row.id, { processed, status: 'ready' });
        } catch (reason) { update(row.id, { status: 'failed', error: (reason as Error).message }); }
        finally { bitmap?.close(); }
      }
    } catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { busy.current = false; if (alive.current) setLoading(false); }
  };
  const conflicts = conflictingProducts(rows);
  const unresolved = rows.filter(row => row.included && !row.approved && (!row.processed || !row.targets.length
    || row.targets.some(id => conflicts.has(id) || !products.some(product => product.documentId === id)
      || products.some(product => product.documentId === id && needsReplacement(product) && !row.confirmed.includes(id)))));
  const run = async (onlyId?: string, onlyProductId?: string) => {
    if (busy.current || unresolved.length) return;
    const pending = rows.filter(row => row.included && row.processed && row.status !== 'complete' && (!onlyId || onlyId === row.id));
    if (!pending.length) return;
    busy.current = true; setRunning(true); setError('');
    await runImageWorkers(pending, async row => {
      if (!alive.current) return;
      const approved = row.approved ?? row.targets.map(id => imageTarget(products.find(product => product.documentId === id)!, row.confirmed.includes(id)));
      const targets = approved.filter(target => (!onlyProductId || onlyProductId === target.documentId)
        && !row.results.some(result => result.documentId === target.documentId && result.status !== 'failed'));
      update(row.id, { approved, status: 'uploading', error: '' });
      try {
        const data = await assignProductImage(outletId, token, row.requestId, row.processed!, targets, imageGrant);
        if (!alive.current) return;
        const results = [...row.results.filter(result => !targets.some(target => target.documentId === result.documentId)), ...data.results];
        for (const result of data.results) if (result.status !== 'failed') onSaved(result.documentId, data.image);
        update(row.id, { results, status: results.some(result => result.status === 'failed') ? 'failed' : 'complete' });
      } catch (reason) {
        if ((reason as { status?: number }).status === 401) onSessionExpired();
        update(row.id, { status: 'failed', error: (reason as Error).message });
      }
    });
    busy.current = false; if (alive.current) setRunning(false);
  };
  const crop = rows.find(row => row.id === cropId);
  const successes = rows.flatMap(row => row.results).filter(result => result.status !== 'failed').length;
  const failures = rows.reduce((count, row) => count + (row.error && row.approved
    ? row.approved.filter(target => !row.results.some(result => result.documentId === target.documentId && result.status !== 'failed')).length
    : row.results.filter(result => result.status === 'failed').length), 0);
  const uploadFinished = !running && rows.some(row => row.approved) && !rows.some(row => row.status === 'uploading');
  const allSucceeded = rows.filter(row => row.included).every(row => row.status === 'complete');
  useEffect(() => {
    if (uploadFinished) {
      confirmation.current?.scrollIntoView({ block: 'nearest' });
      confirmation.current?.focus({ preventScroll: true });
    }
  }, [uploadFinished, successes, failures]);
  const entries = rows.filter(row => row.included).flatMap(row => (row.targets.length ? row.targets : ['']).map(documentId => ({
    row, documentId, product: products.find(product => product.documentId === documentId),
  })));
  const canUpload = !loading && !running && !unresolved.length && rows.some(row => row.included && row.status !== 'complete');
  return <section className="products-page-shell product-image-batch" aria-label={mode === 'bulk' ? 'Bulk Upload Images' : 'One Image for Multiple Products'}>
    <div className="products-header batch-header"><h1>Product Images</h1>
      <div className="batch-header-actions">
        <span className="batch-image-count" aria-label="Total product images">{entries.length} {entries.length === 1 ? 'image' : 'images'}</span>
        <button type="button" className="btn-primary-add batch-upload" disabled={loading || running || (rows.length > 0 && !canUpload)}
          onClick={() => { if (rows.length) void run(); else fileInput.current?.click(); }}>Upload Images</button>
      </div>
    </div>
    <input ref={fileInput} hidden type="file" aria-label={mode === 'bulk' ? 'Choose image ZIP' : 'Choose shared image'}
      accept={mode === 'bulk' ? '.zip,application/zip' : 'image/jpeg,image/png,image/webp'} disabled={loading || running}
      onChange={event => { void load(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
    {!rows.length && !loading && <p className="batch-empty">{mode === 'bulk' ? 'Choose a ZIP of JPEG, PNG or WebP images.' : 'Choose an image to share with your products.'}</p>}
    {loading && <p role="status">Reading and preparing images…</p>}
    {error && <p className="local-image-error" role="alert">{error}</p>}
    {rows.length > 0 && <>
      <div className="products-table-card batch-image-list"><table className="products-table batch-image-table" aria-label="Product images">
        <thead><tr><th>Image</th><th>Product Name</th><th>Status</th><th className="products-actions-heading">Actions</th></tr></thead>
        <tbody>{entries.map(({ row, documentId, product }) => {
          const result = row.results.find(result => result.documentId === documentId);
          return <tr key={`${row.id}:${documentId}`}>
            <td>{row.processed ? <><ProcessedPreview file={row.processed} /><small>{productImageSizeLabel(row.processed)}</small></> : <span className="batch-preview-pending">—</span>}</td>
            <td className="products-name">{product ? productName(product) : 'Select a product'}</td>
            <td><span className={`batch-status ${result?.status ?? row.status}`} role="status">{statusLabel(result?.status ?? row.status)}</span></td>
            <td><div className="batch-row-actions">
              <button type="button" className="btn-secondary" disabled={loading || running || !!row.approved} onClick={() => setCropId(row.id)}>Crop / Adjust</button>
              <button type="button" className="btn-secondary" disabled={running || !!row.approved || !documentId}
                onClick={() => update(row.id, { targets: row.targets.filter(target => target !== documentId), confirmed: row.confirmed.filter(target => target !== documentId) })}>Remove</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      <details className="batch-assignment-review" open={reviewOpen} onToggle={event => setReviewOpen(event.currentTarget.open)}>
        <summary>Review assignments{unresolved.length > 0 ? ' · Action required' : ''}</summary>
        <div className="batch-review-toolbar">
          <label>Search products<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <button type="button" className="btn-secondary" disabled={loading || running} onClick={() => fileInput.current?.click()}>{mode === 'bulk' ? 'Choose another ZIP' : 'Choose another image'}</button>
        </div>
        <p className="batch-review-help">{mode === 'bulk' ? 'Review matches, exclude images you do not want, and approve any replacements. ZIPs support up to 50 images (25 MB ZIP, 100 MB expanded).'
          : 'Select up to 50 products and approve any replacements.'}</p>
        {rows.map(row => <div key={row.id} className="batch-assignment-item" data-filename={row.original.name}>
          <label className="batch-include"><input type="checkbox" checked={row.included} disabled={running || !!row.approved} onChange={event => update(row.id, { included: event.target.checked })} />Include {row.original.name}</label>
          {row.warning && <p className="batch-review-warning">{row.warning}</p>}
          {!row.approved && (mode === 'bulk' ? <label>Product for {row.original.name}<select disabled={running} value={row.targets[0] ?? ''}
            onChange={event => update(row.id, { targets: event.target.value ? [event.target.value] : [], confirmed: [] })}>
            <option value="">Choose a product…</option>{products.filter(product => row.targets.includes(product.documentId) || productLabel(product).toLowerCase().includes(search.toLowerCase())).map(product =>
              <option key={product.documentId} value={product.documentId}>{productLabel(product)}</option>)}
          </select></label> : <div className="batch-product-choices" aria-label="Available products">{products.filter(product => productLabel(product).toLowerCase().includes(search.toLowerCase())).map(product =>
            <label key={product.documentId}><input type="checkbox" value={product.documentId} checked={row.targets.includes(product.documentId)} disabled={running || (!row.targets.includes(product.documentId) && row.targets.length >= MAX_BATCH_IMAGES)}
              onChange={event => update(row.id, { targets: event.target.checked ? [...new Set([...row.targets, product.documentId])] : row.targets.filter(id => id !== product.documentId), confirmed: row.confirmed.filter(id => id !== product.documentId) })} />{productLabel(product)}{needsReplacement(product) ? ' · Has image' : ''}</label>)}</div>)}
          <ul className="batch-replacement-approvals">{row.targets.filter(id => conflicts.has(id) || (!row.approved && products.some(product => product.documentId === id && needsReplacement(product)))).map(id => {
            const product = products.find(value => value.documentId === id);
            return <li key={id}>
              {conflicts.has(id) && <p className="local-image-error">Multiple images target this product. Exclude an image or change its target.</p>}
              {product && needsReplacement(product) && !row.approved && <label><input type="checkbox" checked={row.confirmed.includes(id)} disabled={running}
                onChange={event => update(row.id, { confirmed: event.target.checked ? [...row.confirmed, id] : row.confirmed.filter(target => target !== id) })} />Confirm replacement for {productName(product)}</label>}
            </li>;
          })}</ul>
          {row.error && <p className="local-image-error" role="alert">{row.error}</p>}
          {row.status === 'failed' && <p className="local-image-error">Failed</p>}
          {row.results.filter(result => result.status === 'failed').map(result => <div key={result.documentId} className="batch-failed-result">
            <p role="alert">{products.some(product => product.documentId === result.documentId) ? productName(products.find(product => product.documentId === result.documentId)!) : 'Product unavailable'}: {result.message}</p>
            <button type="button" className="btn-secondary" disabled={running || !!unresolved.length}
              onClick={() => void run(row.id, result.documentId)}>Retry {products.find(product => product.documentId === result.documentId) ? productName(products.find(product => product.documentId === result.documentId)!) : 'product'}</button>
          </div>)}
          {row.approved && row.status === 'failed' && <button type="button" className="btn-secondary" disabled={running || !!unresolved.length} onClick={() => void run(row.id)}>Retry failed assignments for {row.original.name}</button>}
        </div>)}
      </details>
      {uploadFinished && !allSucceeded && <p ref={confirmation} tabIndex={-1} className="category-form-error" role="alert">Some images could not be uploaded. Review the failed items and retry.</p>}
    </>}
    <button type="button" className="btn-secondary batch-back" disabled={running || loading} onClick={onClose}>Back to Products</button>
    {uploadFinished && allSucceeded && successes > 0 && <UploadSuccessDialog count={successes} onClose={onClose} />}
    {crop && <ProductImageCropper file={crop.original} onCancel={() => setCropId(null)} onApply={file => {
      update(crop.id, { processed: file, error: '', status: 'ready', requestId: createRequestId() }); setCropId(null);
    }} />}
  </section>;
}

function UploadSuccessDialog({ count, onClose }: { count: number; onClose: () => void }) {
  useSuccessDismiss(`Images uploaded successfully: ${count}`, onClose);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="category-modal product-image-upload-success" aria-labelledby="image-upload-success-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-header"><h3 id="image-upload-success-title">Images uploaded successfully</h3></div>
    <div className="modal-body"><p>Product images uploaded successfully for {count} product(s).</p></div>
    <div className="modal-footer"><button type="button" className="btn-primary-add" autoFocus onClick={onClose}>OK</button></div>
  </dialog>;
}
