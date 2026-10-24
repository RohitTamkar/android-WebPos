import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { loadProductList, ProductListRequestError } from './productListApi.ts';
import { createRequestId } from '../utils/requestId.ts';
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
  const [selected, setSelected] = useState('');
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
      .then(data => { if (!controller.signal.aborted) setProducts(data); })
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
  const addProduct = () => {
    if (!selected || locked) return;
    if (rows.length >= 100) { setError('A stock adjustment can contain up to 100 products.'); return; }
    if (mode === 'out' && !remark.trim()) { setError('Select or enter a remark before adding a product.'); return; }
    setRows(current => [...current, { productId: selected, quantity: '1', remark: mode === 'out' ? remark.trim() : '' }]);
    setSelected(''); setError(''); pending.current = null;
  };
  const save = async () => {
    if (busy.current || !mode) return;
    if (!pending.current) {
      if (!canReview) return;
      pending.current = { requestId: createRequestId(), direction: mode, items: rows.map(row => ({ productId: row.productId,
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
      pending.current = null; setUncertain(false); setRows([]); setSelected(''); setConfirming(false);
      setSuccess(mode === 'in' ? 'Stock added successfully' : 'Stock removed successfully');
      setReload(value => value + 1);
    } catch (failure) {
      if (pending.current) setUncertain(true);
      setError((failure as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  const refresh = () => { if (!locked) { setReload(value => value + 1); setError(''); } };

  return <section className="devices-page stock-adjustment-page">
    <header className="devices-heading"><div><span>MASTERS</span><h1><Package />{mode ? mode === 'in' ? 'Stock In' : 'Stock Out' : 'Stock In and Out'}</h1><p>{outlet.name} · {mode ? 'Select products and quantities, then review before saving.' : 'Receive stock or record stock leaving your outlet.'}</p></div>
      {mode && <button type="button" className="devices-refresh" disabled={locked} onClick={() => { setMode(null); setError(''); }}><ArrowLeft /> Back</button>}
    </header>
    {!mode ? <div className="stock-choice-grid">{(['in', 'out'] as const).map(direction => <article className="stock-choice-card" key={direction}>
      {direction === 'in' ? <ArrowDownToLine /> : <ArrowUpFromLine />}<h2>{direction === 'in' ? 'Stock In' : 'Stock Out'}</h2><p>{direction === 'in' ? 'Add received quantities to current stock.' : 'Record issued quantities with a remark.'}</p>
      <button type="button" className="stock-primary" aria-label={`Go ahead with Stock ${direction === 'in' ? 'In' : 'Out'}`} onClick={() => { setMode(direction); setRows([]); setSelected(''); setRemark(''); pending.current = null; }}>Go Ahead</button>
    </article>)}</div> : <>
      {success && <SuccessPopup message={success} onDismiss={() => setSuccess('')} />}
      {error && !confirming && <p role="alert" className="stock-error">{error}</p>}
      {loading ? <div className="devices-state" role="status"><RefreshCw />Loading products…</div> : loadError ? <div className="devices-state"><p role="alert">{loadError}</p><button type="button" className="devices-refresh" disabled={locked} onClick={refresh}>Retry loading products</button></div> : <>
        <div className="stock-entry-toolbar"><label>Product<select aria-label="Select product" disabled={locked} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select Product</option>
          {products.filter(product => !rows.some(row => row.productId === product.documentId)).map(product => <option key={product.documentId} value={product.documentId} disabled={!validStock(product.fields.currentStock)}>{text(product.fields.code)} · {text(product.fields.name)}</option>)}
        </select></label>
        {mode === 'out' && <label>Remark<input aria-label="Select remark" list="stock-remark-options" placeholder="Select or enter remark" maxLength={500} value={remark} disabled={locked} onChange={event => setRemark(event.target.value)} /><datalist id="stock-remark-options">{remarks.map(value => <option key={value} value={value} />)}</datalist></label>}
        <button type="button" className="devices-refresh" aria-label="Add selected product" disabled={locked || !selected} onClick={addProduct}><Plus /></button>
        <button type="button" className="devices-refresh" disabled={locked} onClick={refresh}><RefreshCw />Refresh stock</button></div>
        <div className="devices-table-scroll stock-entry-table"><table><thead><tr><th>Code</th><th>Name</th><th>Current stock</th><th>Req stock</th>{mode === 'out' && <th>Remark</th>}<th>Delete</th></tr></thead><tbody>
          {!rows.length && <tr><td colSpan={mode === 'out' ? 6 : 5}><div className="stock-empty">{products.length ? 'No data available. Select a product to add it.' : 'No products available for this outlet.'}</div></td></tr>}
          {rows.map(row => { const product = findProduct(row.productId); const problem = rowError(row); return <tr key={row.productId}><td>{text(product?.fields.code)}</td><td>{text(product?.fields.name)}</td><td>{validStock(product?.fields.currentStock) ? quantity(product.fields.currentStock) : 'Unavailable'}</td>
            <td><input type="number" min="0.001" step="0.001" max={mode === 'out' && validStock(product?.fields.currentStock) ? product.fields.currentStock : 1e9} aria-label={`Quantity for ${text(product?.fields.name)}`} value={row.quantity} disabled={locked} onChange={event => { pending.current = null; setRows(current => current.map(value => value.productId === row.productId ? { ...value, quantity: event.target.value } : value)); }} />{problem && <small className="stock-error">{problem}</small>}</td>
            {mode === 'out' && <td><input aria-label={`Remark for ${text(product?.fields.name)}`} value={row.remark} maxLength={500} disabled={locked} onChange={event => setRows(current => current.map(value => value.productId === row.productId ? { ...value, remark: event.target.value } : value))} /></td>}
            <td><button type="button" className="devices-refresh" aria-label={`Remove ${text(product?.fields.name)}`} disabled={locked} onClick={() => setRows(current => current.filter(value => value.productId !== row.productId))}><Trash2 /></button></td></tr>; })}
        </tbody></table></div>
        <footer className="stock-entry-footer"><span>{rows.length} products selected · Changes are saved only after confirmation.</span><button type="button" className="stock-primary" disabled={!canReview || locked} onClick={() => { setError(''); setConfirming(true); }}><Plus />{mode === 'in' ? 'Add Stock' : 'Remove Stock'}</button></footer>
      </>}
    </>}
    <dialog ref={dialog} className="stock-confirm-dialog" aria-labelledby="stock-confirm-title" onCancel={event => { if (locked) event.preventDefault(); else setConfirming(false); }}><h2 id="stock-confirm-title">Confirm Stock {mode === 'in' ? 'In' : 'Out'}</h2><p>{outlet.name} · Review the quantities before saving.</p><ul>{rows.map(row => <li key={row.productId}>{text(findProduct(row.productId)?.fields.name)}: {row.quantity}{mode === 'out' ? ` · ${row.remark}` : ''}</li>)}</ul>
      {error && <p role="alert" className="stock-error">{error}</p>}{uncertain && <p>The save outcome is uncertain. Retry this confirmation to check it without applying stock twice.</p>}
      <div><button type="button" className="devices-refresh" disabled={locked} onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="stock-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : uncertain ? 'Retry confirmation' : 'Confirm stock changes'}</button></div>
    </dialog>
  </section>;
}
