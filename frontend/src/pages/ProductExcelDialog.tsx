import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import './CategoryPage.css';
import './ProductExcelDialog.css';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function ProductExcelDialog({ outletId, token, onCancel, onComplete, onSessionExpired }: {
  outletId: string; token: string; onCancel: () => void; onComplete: (message: string) => void; onSessionExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => pending.current?.abort(); }, []);
  const exportProducts = async () => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/export/download`, {
        method: 'GET', signal: controller.signal, cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(result?.message || 'Unable to export products. Please try again.');
      }
      if (!response.headers.get('Content-Type')?.includes(XLSX_TYPE)) throw new Error('The server did not return a valid Excel file.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('The server returned an empty Excel file.');
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Products.xlsx'; anchor.click();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      const warnings = Number(response.headers.get('X-Export-Warnings')) || 0;
      if (!controller.signal.aborted) onComplete('Product Excel download started.'
        + (warnings ? ' Some mappings could not be resolved; see the Export Notes worksheet.' : ''));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to export products. Please try again.');
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(false); }
    }
  };
  return <dialog ref={dialog} className="category-modal product-excel-dialog" aria-labelledby="product-excel-title"
    onCancel={event => { event.preventDefault(); if (!pending.current) onCancel(); }}>
    <div aria-busy={busy}>
      <div className="modal-header"><h3 id="product-excel-title">Save Excel</h3>
        <button type="button" className="modal-close-btn" aria-label="Close Save Excel" disabled={busy} onClick={onCancel}><X size={18} /></button></div>
      <div className="modal-body">
        <p>Export all products for this outlet, including premises prices.</p>
        <div className="product-excel-options">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void exportProducts()}><Download size={16} />{busy ? 'Exporting…' : 'Download'}</button>
        </div>
        {error && <p id="product-export-error" className="category-form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </div>
  </dialog>;
}
