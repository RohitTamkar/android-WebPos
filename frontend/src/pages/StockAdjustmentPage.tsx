import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Package, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { loadProductList, ProductListRequestError } from './productListApi.ts';
import { createFirestoreDocumentId } from '../utils/requestId.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import './DevicesPage.css';
import './StockAdjustmentPage.css';

type Product = { documentId: string; fields: Record<string, unknown> };
type Row = { productId: string; quantity: string; remark: string };
type Payload = { requestId: string; direction: 'in' | 'out'; items: { productId: string; quantity: number; expectedStock: number; remark: string }[] };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
const validStock = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const quantity = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(value);

export function StockAdjustmentPage({ outlet, token, onSessionExpired }: { outlet: OutletSummary; token: string; onSessionExpired: () => void }) {
  const [mode, setMode] = useState<'in' | 'out' | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [remark, setRemark] = useState('');
  const [remarks, setRemarks] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Payload | null>(null);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;

  useEffect(() => {
    const controller = new AbortController();
    // Clear the previous request's data while synchronizing with this outlet/refresh.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true); setLoadError(''); setProducts([]);
    void loadProductList<Product>(`${base}/products`, token, controller.signal, 'products')
      .then(data => { if (!controller.signal.aborted) setProducts(data.filter(product => product.fields.stockable === true)); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof ProductListRequestError && failure.status === 401) onSessionExpired();
        setLoadError((failure as Error).message);
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, token, reload, onSessionExpired]);

  useEffect(() => {
    if (mode !== 'out') return;
    const controller = new AbortController();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    void (async () => {
      try {
        const response = await fetch(`${base}/reports/stock-movements?startDate=${today}&endDate=${today}&direction=out`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok) return;
        const result = await response.json() as { data?: { movements?: { items?: { remark?: string }[] }[] } };
        const existing = result.data?.movements?.flatMap(movement => movement.items?.map(item => item.remark ?? '') ?? []) ?? [];
        if (!controller.signal.aborted) setRemarks([...new Set(existing.filter(value => value.trim()))].sort());
      } catch { /* Remarks remain editable when no saved suggestions are available. */ }
    })();
    return () => controller.abort();
  }, [base, token, mode, onSessionExpired]);

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);

  const findProduct = (id: string) => products.find(product => product.documentId === id);
  const rowError = (row: Row) => {
    const stock = findProduct(row.productId)?.fields.currentStock;
    if (!validStock(stock)) return 'Current stock is unavailable. Refresh the products.';
    const amount = Number(row.quantity);
    if (!row.quantity.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 1e9 || Math.abs(amount * 1000 - Math.round(amount * 1000)) > 1e-6) return 'Enter a positive quantity with up to three decimal places.';
    if (mode === 'out' && amount > stock) return 'Requested quantity exceeds current stock.';
    if (mode === 'out' && !row.remark.trim()) return 'Enter a stock-out remark.';
    return '';
  };
  const canReview = rows.length > 0 && !rows.some(rowError) && !loading && !loadError;
  const locked = saving || uncertain;
  const addProduct = (productId: string) => {
    if (!productId || locked) return;
    if (findProduct(productId)?.fields.stockable !== true) { setError('Select a product marked Stockable.'); return; }
    if (rows.length >= 100) { setError('A stock adjustment can contain up to 100 products.'); return; }
    setRows(current => current.some(row => row.productId === productId) ? current
      : [...current, { productId, quantity: '1', remark: mode === 'out' ? remark.trim() : '' }]);
    setError(''); pending.current = null;
  };
  const save = async () => {
    if (busy.current || !mode) return;
    if (!pending.current) {
      if (!canReview) return;
      pending.current = { requestId: createFirestoreDocumentId(), direction: mode, items: rows.map(row => ({ productId: row.productId,
        quantity: Number(row.quantity), expectedStock: findProduct(row.productId)!.fields.currentStock as number, remark: row.remark.trim() })) };
    }
    busy.current = true; setSaving(true); setError('');
    try {
      const response = await fetch(`${base}/stock-adjustments`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current) });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; data?: { documentId: string }; message?: string };
      if (!response.ok || result.success !== true || !result.data) {
        if ([400, 403, 404, 409, 422].includes(response.status)) { pending.current = null; setUncertain(false); setConfirming(false); }
        else setUncertain(true);
        throw new Error(result.message || 'The stock save could not be confirmed. Retry the same confirmation.');
      }
      pending.current = null; setUncertain(false); setRows([]); setConfirming(false);
      setSuccess(mode === 'in' ? 'Stock added successfully' : 'Stock removed successfully');
      setReload(value => value + 1);
    } catch (failure) {
      if (pending.current) setUncertain(true);
      setError((failure as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  const refresh = () => { if (!locked) { setReload(value => value + 1); setError(''); } };

  return <section className="devices-page stock-adjustment-page stock-movement-page">
    <header className="devices-heading"><div><span>MASTERS</span><h1>{mode === 'in' ? <ArrowDownToLine /> : mode === 'out' ? <ArrowUpFromLine /> : <Package />}{mode ? mode === 'in' ? 'Stock In' : 'Stock Out' : 'Stock In and Out'}</h1><p>{outlet.name} · {mode ? 'Select stockable products and quantities, then review before saving.' : 'Receive stock or record stock leaving your outlet.'}</p></div>
      {mode && <button type="button" className="devices-refresh" disabled={locked} onClick={() => { setMode(null); setError(''); }}><ArrowLeft /> Back</button>}
    </header>
    {!mode ? <div className="stock-choice-grid">{(['in', 'out'] as const).map(direction => <article className="stock-choice-card" key={direction}>
      {direction === 'in' ? <ArrowDownToLine /> : <ArrowUpFromLine />}<h2>{direction === 'in' ? 'Stock In' : 'Stock Out'}</h2><p>{direction === 'in' ? 'Add received quantities to current stock.' : 'Record issued quantities with a remark.'}</p>
      <button type="button" className="stock-primary" aria-label={`Go ahead with Stock ${direction === 'in' ? 'In' : 'Out'}`} onClick={() => { setMode(direction); setRows([]); setRemark(''); pending.current = null; }}>Go Ahead</button>
    </article>)}</div> : <>
      {success && <SuccessPopup message={success} onDismiss={() => setSuccess('')} />}
      {error && !confirming && <p role="alert" className="stock-error">{error}</p>}
      {loading ? <div className="devices-state" role="status"><RefreshCw />Loading products…</div> : loadError ? <div className="devices-state"><p role="alert">{loadError}</p><button type="button" className="devices-refresh" disabled={locked} onClick={refresh}>Retry loading products</button></div> : <>
        {!products.length && <p role="status">No stockable products are available. Mark a product Stockable in Products to adjust its stock.</p>}
        <div className="stock-workspace">
        <div className="stock-workspace-heading"><div><h2>{mode === 'in' ? 'Receive stock' : 'Issue stock'}</h2><p>Select a product to add it instantly to your list.</p></div></div>
        <div className="stock-entry-toolbar"><label>Product<select aria-label="Select product" disabled={locked} value="" onChange={event => addProduct(event.target.value)}><option value="">Select Product</option>
          {products.filter(product => !rows.some(row => row.productId === product.documentId)).map(product => <option key={product.documentId} value={product.documentId} disabled={!validStock(product.fields.currentStock)}>{text(product.fields.code)} · {text(product.fields.name)}</option>)}
        </select></label>
        {mode === 'out' && <label>Default remark <span className="stock-label-hint">For new rows</span><input aria-label="Select remark" list="stock-remark-options" placeholder="Select or enter remark" maxLength={500} value={remark} disabled={locked} onChange={event => setRemark(event.target.value)} /><datalist id="stock-remark-options">{remarks.map(value => <option key={value} value={value} />)}</datalist></label>}
        <button type="button" className="devices-refresh" disabled={locked} onClick={refresh}><RefreshCw />Refresh stock</button></div>
        <div className="devices-table-scroll stock-entry-table"><table><thead><tr><th>Code</th><th>Product</th><th>Current stock</th><th>{mode === 'in' ? 'Quantity to add' : 'Quantity to remove'}</th>{mode === 'out' && <th>Remark</th>}<th><span className="stock-action-heading">Remove</span></th></tr></thead><tbody>
          {!rows.length && <tr><td colSpan={mode === 'out' ? 6 : 5}><div className="stock-empty"><div className="stock-empty-icon"><Package aria-hidden="true" /></div>
            <strong>{products.length ? 'Your stock list is empty' : 'No stockable products yet'}</strong><p>{products.length ? 'Choose a product above, then enter the quantity.' : 'Mark products as Stockable in Products to get started.'}</p>
            <span>{mode === 'in' ? 'Received items will increase your current stock.' : 'Issued items will decrease your current stock.'}</span></div></td></tr>}
          {rows.map(row => { const product = findProduct(row.productId); const problem = rowError(row); return <tr key={row.productId}><td><span className="stock-product-code">{text(product?.fields.code)}</span></td><td><strong className="stock-product-name">{text(product?.fields.name)}</strong></td><td><span className="stock-current-quantity">{validStock(product?.fields.currentStock) ? quantity(product.fields.currentStock) : 'Unavailable'}</span></td>
            <td><input type="number" min="0.001" step="0.001" max={mode === 'out' && validStock(product?.fields.currentStock) ? product.fields.currentStock : 1e9} aria-invalid={!!problem} aria-label={`Quantity for ${text(product?.fields.name)}`} value={row.quantity} disabled={locked} onChange={event => { pending.current = null; setRows(current => current.map(value => value.productId === row.productId ? { ...value, quantity: event.target.value } : value)); }} />{problem && <small className="stock-error">{problem}</small>}</td>
            {mode === 'out' && <td><input aria-label={`Remark for ${text(product?.fields.name)}`} value={row.remark} maxLength={500} disabled={locked} onChange={event => setRows(current => current.map(value => value.productId === row.productId ? { ...value, remark: event.target.value } : value))} /></td>}
            <td><button type="button" className="devices-refresh" aria-label={`Remove ${text(product?.fields.name)}`} disabled={locked} onClick={() => setRows(current => current.filter(value => value.productId !== row.productId))}><Trash2 /></button></td></tr>; })}
        </tbody></table></div>
        <footer className="stock-entry-footer">
          <button type="button" className="stock-primary" disabled={!canReview || locked} onClick={() => { setError(''); setConfirming(true); }}>{mode === 'in' ? <ArrowDownToLine /> : <ArrowUpFromLine />}{mode === 'in' ? 'Add Stock' : 'Remove Stock'}</button></footer>
        </div>
        <p className="stock-save-note"><ShieldCheck aria-hidden="true" />Review before saving. Stock changes only after you confirm.</p>
      </>}
    </>}
    <dialog ref={dialog} className="stock-confirm-dialog" aria-labelledby="stock-confirm-title" onCancel={event => { if (locked) event.preventDefault(); else setConfirming(false); }}><h2 id="stock-confirm-title">Confirm Stock {mode === 'in' ? 'In' : 'Out'}</h2><p>{outlet.name} · Review the quantities before saving.</p><ul>{rows.map(row => <li key={row.productId}>{text(findProduct(row.productId)?.fields.name)}: {row.quantity}{mode === 'out' ? ` · ${row.remark}` : ''}</li>)}</ul>
      {error && <p role="alert" className="stock-error">{error}</p>}{uncertain && <p>The save outcome is uncertain. Retry this confirmation to check it without applying stock twice.</p>}
      <div><button type="button" className="devices-refresh" disabled={locked} onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="stock-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : uncertain ? 'Retry confirmation' : 'Confirm stock changes'}</button></div>
    </dialog>
  </section>;
}
