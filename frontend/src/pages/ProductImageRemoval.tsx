import { useEffect, useRef, useState } from 'react';
import { removeMasterImage } from './imageApi.ts';
import { runImageWorkers, type ImageProduct } from './productImageBatch.ts';
import './CategoryPage.css';
import './DeleteConfirmation.css';

interface RemovalRow {
  documentId: string; name: string; image: string | null; imagePath: string | null;
  status: 'pending' | 'removing' | 'removed' | 'failed'; message: string;
}

export function ProductImageRemoval({ products, outletId, outletName, token, imageGrant, onRemoved, onClose, onSessionExpired }: {
  products: ImageProduct[]; outletId: string; outletName: string; token: string; imageGrant: string;
  onRemoved: (documentId: string) => void;
  onClose: (summary?: { removed: number; failed: number }) => void; onSessionExpired: () => void;
}) {
  const [rows, setRows] = useState<RemovalRow[]>(() => products.map(product => ({ documentId: product.documentId,
    name: String(product.fields.name ?? product.documentId), image: typeof product.fields.image === 'string' && product.fields.image ? product.fields.image : null,
    imagePath: typeof product.fields.imagePath === 'string' && product.fields.imagePath ? product.fields.imagePath : null, status: 'pending', message: '' })));
  const [started, setStarted] = useState(false), [running, setRunning] = useState(false);
  const busy = useRef(false), active = useRef(true), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current = true; dialog.current?.showModal(); cancel.current?.focus();
    return () => { active.current = false; };
  }, []);
  const removed = rows.filter(row => row.status === 'removed').length;
  const failed = rows.filter(row => row.status === 'failed').length;
  const update = (id: string, status: RemovalRow['status'], message = '') => {
    if (active.current) setRows(current => current.map(row => row.documentId === id ? { ...row, status, message } : row));
  };
  const run = async () => {
    if (busy.current) return;
    busy.current = true; setStarted(true); setRunning(true);
    await runImageWorkers(rows.filter(row => row.status === 'pending' || row.status === 'failed'), async row => {
      if (!active.current) return;
      update(row.documentId, 'removing');
      try {
        await removeMasterImage(outletId, 'products', row.documentId, token, { image: row.image, imagePath: row.imagePath }, imageGrant);
        if (active.current) { onRemoved(row.documentId); update(row.documentId, 'removed'); }
      } catch (reason) {
        if ((reason as { status?: number }).status === 401) onSessionExpired();
        update(row.documentId, 'failed', (reason as Error).message);
      }
    });
    busy.current = false; if (active.current) setRunning(false);
  };
  const close = () => { if (!busy.current) onClose(started ? { removed, failed } : undefined); };
  return <dialog ref={dialog} className="category-modal delete-confirmation" aria-modal="true" aria-labelledby="remove-images-title" aria-describedby="remove-images-description"
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="modal-header"><h3 id="remove-images-title">{started ? 'Product image removal results' : 'Remove all product images?'}</h3></div>
    <div className="modal-body">
      <p id="remove-images-description">Remove images from <strong>{rows.length} products</strong> in <strong>{outletName}</strong>?
        {' '}This includes every category and products hidden by search. Product records and shared Storage files are kept.</p>
      {started && <p className={!running && failed === 0 ? 'products-notice' : undefined} role="status">{running ? 'Removing product images…' : failed ? 'Removal finished with errors.' : 'Product images removed successfully.'}
        {' '}{removed} removed; {failed} failed.</p>}
      {failed > 0 && <ul>{rows.filter(row => row.status === 'failed').map(row => <li key={row.documentId}>{row.name}: {row.message}</li>)}</ul>}
    </div>
    <div className="modal-footer">
      <button ref={cancel} type="button" className="btn-secondary" disabled={running} onClick={close}>{started ? 'Done' : 'Cancel'}</button>
      {!started && <button type="button" className="btn-primary-add" disabled={running || !rows.length} onClick={() => void run()}>Confirm remove all images</button>}
      {started && failed > 0 && <button type="button" className="btn-primary-add" disabled={running} onClick={() => void run()}>Retry failed removals</button>}
    </div>
  </dialog>;
}
