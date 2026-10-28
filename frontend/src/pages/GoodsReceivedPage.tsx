import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, Plus, ReceiptText, RefreshCw, Search, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { loadProductList, ProductListRequestError } from './productListApi.ts';
import { goodsReceiptRequest, GoodsReceiptError, type ReceiptSupplier, type GoodsReceiptOptions, type GoodsReceiptPayload, type SupplierCreatePayload, type SupplierCreateResult } from './goodsReceivedApi.ts';
import './DevicesPage.css';
import './StockAdjustmentPage.css';
import './GoodsReceivedPage.css';

type SupplierDetails = { name: string; contact: string; shortName: string; searchCode: string; alternateNumbers: string; email: string; gstIn: string; address: string };
type Product = { id: string; code: string; barcode: string; name: string; category: string; stock: number | null; unit: string; cost: number; price: number };
const unitNames: Record<number, string> = { 0: 'Kilogram', 1: 'Liter', 2: 'Number', 3: 'Millilitre', 4: 'Box', 5: 'Tin', 6: 'Jar', 7: 'Bottle', 8: 'Gram', 9: 'Meter', 10: 'Dozen', 11: 'Bag', 12: 'Piece' };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
type Row = { productId: string; quantity: string; cost: string; price: string };
const validQuantity = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e9 && Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) < 1e-6;
const validPrice = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e9;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
const formatQuantity = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(value);
const savedStock = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function GoodsReceivedPage({ outlet, token, onSessionExpired, onCancel }: { outlet: OutletSummary; token: string; onSessionExpired: () => void; onCancel: () => void }) {
  const [suppliers, setSuppliers] = useState<ReceiptSupplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [identity, setIdentity] = useState('');
  const [supplierDraftId, setSupplierDraftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  const pending = useRef<GoodsReceiptPayload | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;
  const locked = saving || uncertain;
  const [stockRefreshing, setStockRefreshing] = useState(false);
  const [stockError, setStockError] = useState('');
  const stockRequest = useRef<AbortController | null>(null);
  const refreshStock = useCallback(async () => {
    if (stockRequest.current) return;
    const controller = new AbortController(); stockRequest.current = controller;
    setStockRefreshing(true); setStockError('');
    try {
      const records = await loadProductList<{ documentId: string; fields: Record<string, unknown> }>(`${base}/products`, token, controller.signal, 'products');
      if (controller.signal.aborted) return;
      const stocks = new Map(records.map(record => [record.documentId, savedStock(record.fields.currentStock)]));
      // Existing stock comes from PRODUCT.currentStock, never from draft quantities
      // or a sum of receipt history (which could count stock adjustments twice).
      setProducts(current => current.map(product => ({ ...product, stock: stocks.get(product.id) ?? null })));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ProductListRequestError && failure.status === 401) onSessionExpired();
      setStockError((failure as Error).message);
    } finally {
      if (stockRequest.current === controller) { stockRequest.current = null; setStockRefreshing(false); }
    }
  }, [base, token, onSessionExpired]);
  useEffect(() => () => { stockRequest.current?.abort(); }, [base, token]);
  useEffect(() => {
    if (loading || locked) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshStock(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loading, locked, refreshStock]);
  useEffect(() => {
    const controller = new AbortController();
    // Clear loading errors when explicitly refreshing the authorized outlet's data.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true); setLoadError('');
    void Promise.all([
      loadProductList<{ documentId: string; fields: Record<string, unknown> }>(`${base}/products`, token, controller.signal, 'products'),
      loadProductList<{ id: string; name: string }>(`${base}/categories`, token, controller.signal, 'categories'),
      goodsReceiptRequest<GoodsReceiptOptions>(`${base}/goods-received`, token, controller.signal),
    ]).then(([records, categories, options]) => {
      if (controller.signal.aborted) return;
      setProducts(records.filter(record => record.fields.stockable === true).map(record => ({
        id: record.documentId, code: text(record.fields.code), barcode: text(record.fields.barcode), name: text(record.fields.name),
        category: categories.find(entry => entry.id === record.fields.category)?.name ?? 'Uncategorized', stock: savedStock(record.fields.currentStock),
        unit: typeof record.fields.unitId === 'number' ? unitNames[record.fields.unitId] ?? '—' : '—',
        cost: typeof record.fields.costPrice === 'number' ? record.fields.costPrice : 0, price: typeof record.fields.price === 'number' ? record.fields.price : 0,
      })));
      setSuppliers(options.suppliers); setIdentity(options.documentId); setSupplierDraftId(options.supplierDraftId);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if ((failure instanceof GoodsReceiptError || failure instanceof ProductListRequestError) && failure.status === 401) onSessionExpired();
      setLoadError((failure as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, token, onSessionExpired, reload]);
  useEffect(() => { if (confirming) confirmation.current?.showModal(); else confirmation.current?.close(); }, [confirming]);
  const [supplier, setSupplier] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const visibleProducts = products.filter(product => (!category || product.category === category)
    && [product.name, product.code, product.barcode].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const validAmounts = rows.every(row => validPrice(row.cost) && validPrice(row.price) && Number.isFinite(Number(row.quantity) * Number(row.cost)));
  const toggleProduct = (product: Product) => {
    if (locked) return;
    if (!rows.some(row => row.productId === product.id) && rows.length >= 100) { setError('A receipt can contain up to 100 products.'); return; }
    setRows(current => current.some(row => row.productId === product.id)
      ? current.filter(row => row.productId !== product.id)
      : [...current, { productId: product.id, quantity: '1', cost: String(product.cost), price: String(product.price) }]);
    setError(''); setNotice('');
  };
  const reset = () => {
    setSupplier(''); setSearch(''); setCategory('');
    setRows([]); setError(''); setNotice('');
  };
  const review = () => {
    setNotice('');
    if (supplier && !suppliers.some(entry => entry.id === supplier)) { setError('Select a supplier.'); return; }
    if (!rows.length) { setError('Add at least one product.'); return; }
    if (rows.some(row => !validQuantity(row.quantity))) { setError('Enter a positive received quantity up to 1,000,000,000 with up to three decimal places for every product.'); return; }
    if (!validAmounts) { setError('Enter finite, nonnegative prices.'); return; }
    if (!identity) { setError('Reload receipts before saving.'); return; }
    setError(''); setConfirming(true);
  };

  const save = async () => {
    if (busy.current) return;
    if (!pending.current) {
      const selectedSupplier = suppliers.find(entry => entry.id === supplier) ?? null;
      if ((supplier && !selectedSupplier) || !identity || !rows.length) return;
      pending.current = { documentId: identity, goodsReceivedNo: identity, supplier: selectedSupplier,
        items: rows.map(row => ({ productId: row.productId, quantity: Number(row.quantity), cost: Number(row.cost), price: Number(row.price) })) };
    }
    busy.current = true; setSaving(true); setError('');
    try {
      await goodsReceiptRequest<{ documentId: string }>(`${base}/goods-received`, token, undefined, pending.current);
      pending.current = null; setUncertain(false); setConfirming(false); reset();
      setNotice('Goods receipt saved successfully.'); setReload(value => value + 1);
    } catch (failure) {
      if (failure instanceof GoodsReceiptError && failure.status === 401) onSessionExpired();
      if (failure instanceof GoodsReceiptError && [400, 403, 404, 409, 422].includes(failure.status)) {
        pending.current = null; setUncertain(false); setConfirming(false);
      } else setUncertain(true);
      setError((failure as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  if (loading || loadError) return <section className="devices-page"><header className="devices-heading"><div><span>MASTERS</span><h1><ReceiptText />Goods Received</h1></div></header>
    {notice && <p role="status">{notice}</p>}<div className="devices-state">{loading ? 'Loading outlet products, suppliers and receipts…' : <><p role="alert">{loadError}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}>Retry loading</button></>}</div></section>;

  return <section className="devices-page stock-adjustment-page goods-received-page">
    <header className="devices-heading"><div><span>MASTERS</span><h1><ReceiptText />Goods Received</h1><p>Record products received from suppliers.</p></div></header>
    <fieldset className="goods-form-fieldset" disabled={locked}>
    <section className="goods-unified-card" aria-label="Goods received entry">
      <div className="goods-supplier-select">
        <label>Supplier (optional)<select value={supplier} onChange={event => { setSupplier(event.target.value); setNotice(''); }}>
          <option value="">No supplier</option>{suppliers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        <button type="button" className="devices-refresh goods-add-supplier" onClick={() => setAddingSupplier(true)}><Plus />Add Supplier</button>
      </div>
      <div className="goods-search-row"><label className="goods-search-field">Search products<div><Search aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by code, barcode or name" /></div></label></div>
      <div className="goods-products-heading"><div><h2>Products</h2><p>Select the products received, then enter quantities and prices.</p></div>
        <button type="button" className="devices-refresh" disabled={stockRefreshing} onClick={() => void refreshStock()}><RefreshCw aria-hidden="true" />{stockRefreshing ? 'Refreshing…' : 'Refresh stock'}</button>
      </div>
      {stockError && <p role="alert" className="stock-error goods-entry-message">Stock refresh failed: {stockError} Previously loaded stock is still shown.</p>}
      <nav className="goods-category-tabs" aria-label="Product categories">{['', ...new Set(products.map(product => product.category))].map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value || 'All'}</button>)}</nav>
      <div className="devices-table-scroll stock-entry-table goods-products-table"><table aria-label="Stockable products">
        <thead><tr><th>Select</th><th>Code</th><th>Product</th><th>Current stock</th><th>Received qty</th><th>Cost price</th><th>Price</th><th>Line total</th></tr></thead>
        <tbody>{visibleProducts.map(product => {
          const row = rows.find(entry => entry.productId === product.id);
          return <tr key={product.id} className={row ? 'goods-product-selected' : ''}>
            <td><input type="checkbox" className="goods-row-checkbox" aria-label={`Include ${product.name}`} checked={!!row} onChange={() => toggleProduct(product)} /></td>
            <td><span className="goods-code">{product.code || '—'}</span></td>
            <td><button type="button" className="goods-product-select" aria-label={`Select product ${product.name}`} aria-pressed={!!row} onClick={() => toggleProduct(product)}>{product.name}</button><small className="goods-help">{product.category} · {product.unit}</small></td>
            <td><span className="goods-stock-value" aria-label={`Current stock for ${product.name}`}>{product.stock === null ? 'Unavailable' : formatQuantity(product.stock)}</span></td>
            <td><input type="number" min="0.001" step="0.001" disabled={!row} aria-label={`Received quantity for ${product.name}`} aria-invalid={!!row && !validQuantity(row.quantity)} value={row?.quantity ?? ''} placeholder="0" onChange={event => { setRows(current => current.map(entry => entry.productId === product.id ? { ...entry, quantity: event.target.value } : entry)); setNotice(''); }} />{row && !validQuantity(row.quantity) && <small className="stock-error">Enter a positive quantity with up to three decimal places.</small>}</td>
            {(['cost', 'price'] as const).map(field => <td key={field}><input type="number" min="0" step="any" disabled={!row} aria-label={`${field === 'cost' ? 'Cost price' : 'Price'} for ${product.name}`} aria-invalid={!!row && !validPrice(row[field])} value={row?.[field] ?? String(product[field])} onChange={event => { setRows(current => current.map(entry => entry.productId === product.id ? { ...entry, [field]: event.target.value } : entry)); setNotice(''); }} />{row && !validPrice(row[field]) && <small className="stock-error">Enter zero or a positive price.</small>}</td>)}
            <td className="goods-line-total">{row && validQuantity(row.quantity) && validPrice(row.price) && Number.isFinite(Number(row.quantity) * Number(row.price)) ? money(Number(row.quantity) * Number(row.price)) : '—'}</td>
          </tr>;
        })}
        {!visibleProducts.length && <tr><td colSpan={8}><div className="stock-empty"><Package aria-hidden="true" /><strong>{products.length ? 'No products match your search' : 'No stockable products yet'}</strong><span>{products.length ? 'Try another name, barcode, code or category.' : 'Mark products as Stockable in Products to get started.'}</span></div></td></tr>}
        </tbody>
      </table></div>
      {error && <p role="alert" className="stock-error goods-entry-message">{error}</p>}
      {notice && <p role="status" className="goods-preview-note">{notice}</p>}
      <footer className="goods-entry-footer goods-actions">
        <strong className="goods-receipt-total" aria-live="polite">Total: {rows.every(row => validQuantity(row.quantity) && validPrice(row.price)) ? money(rows.reduce((total, row) => total + Number(row.quantity) * Number(row.price), 0)) : '—'}</strong>
        <button type="button" className="devices-refresh" onClick={onCancel}>Cancel</button>
        <button type="button" className="stock-primary" onClick={review}>Save</button>
      </footer>
    </section>
    </fieldset>
    {addingSupplier && <AddReceiptSupplier base={base} token={token} documentId={supplierDraftId} onSessionExpired={onSessionExpired} onClose={() => setAddingSupplier(false)} onSaved={saved => {
      const { id: _id, alternateNumber: _alternateNumber, ...fields } = saved.fields;
      const supplier = { ...fields, id: saved.documentId, alternateNumber: null };
      setSuppliers(current => [...current.filter(entry => entry.id !== saved.documentId), supplier]);
      setSupplier(saved.documentId); setSupplierDraftId(saved.nextDocumentId); setAddingSupplier(false); setNotice('Supplier saved successfully.'); setError('');
    }} />}
    <dialog ref={confirmation} className="stock-confirm-dialog" aria-labelledby="goods-confirm-title" onCancel={event => { if (locked) event.preventDefault(); else setConfirming(false); }}><h2 id="goods-confirm-title">Confirm Goods Received</h2>
      <p>{suppliers.find(entry => entry.id === supplier)?.name || 'No supplier'} · Review the products and quantities before saving.</p>
      <ul>{rows.map(row => <li key={row.productId}>{products.find(product => product.id === row.productId)?.name}: {row.quantity} · cost {row.cost} · price {row.price}</li>)}</ul>
      {error && <p role="alert" className="stock-error">{error}</p>}{uncertain && <p>The save outcome is uncertain. Retry the same confirmation to avoid duplicate receipts.</p>}
      <div><button type="button" className="devices-refresh" disabled={locked} onClick={() => setConfirming(false)}>Keep editing</button><button type="button" className="stock-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : uncertain ? 'Retry confirmation' : 'Confirm receipt'}</button></div>
    </dialog>
  </section>;
}

function AddReceiptSupplier({ base, token, documentId, onSessionExpired, onClose, onSaved }: { base: string; token: string; documentId: string; onSessionExpired: () => void; onClose: () => void; onSaved: (saved: SupplierCreateResult) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<SupplierDetails>({ name: '', contact: '', shortName: '', searchCode: '', alternateNumbers: '', email: '', gstIn: '', address: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const pending = useRef<SupplierCreatePayload | null>(null);
  const locked = saving || uncertain;
  const saveSupplier = async () => {
    if (busy.current) return;
    if (!pending.current) {
      if (!details.name.trim() || !details.contact.trim()) { setError('Name and mobile are required.'); return; }
      if (!documentId) { setError('Reload supplier data before adding a supplier.'); return; }
      pending.current = { documentId, fields: { name: details.name.trim(), mobile: details.contact.trim(), address: details.address.trim(),
        alternateNumber: details.alternateNumbers.trim(), email: details.email.trim(), gstin: details.gstIn.trim() } };
    }
    busy.current = true; setSaving(true); setError('');
    try {
      const saved = await goodsReceiptRequest<SupplierCreateResult>(`${base}/suppliers`, token, undefined, pending.current);
      pending.current = null; onSaved(saved);
    } catch (failure) {
      if (failure instanceof GoodsReceiptError && failure.status === 401) onSessionExpired();
      if (failure instanceof GoodsReceiptError && [400, 403, 404, 409, 422].includes(failure.status)) { pending.current = null; setUncertain(false); }
      else setUncertain(true);
      setError((failure as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  useEffect(() => { dialog.current?.showModal(); }, []);
  const field = (key: keyof SupplierDetails, label: string, required = false, type = 'text') => <label>{label}{required && ' *'}<input autoFocus={key === 'name'} required={required} disabled={locked || ['shortName', 'searchCode'].includes(key)} type={type} maxLength={key === 'address' ? 500 : 200} value={details[key]} onChange={event => setDetails(current => ({ ...current, [key]: event.target.value }))} /></label>;
  return <dialog ref={dialog} className="stock-confirm-dialog goods-supplier-dialog" aria-labelledby="goods-supplier-title" onCancel={event => { if (locked) event.preventDefault(); else onClose(); }}>
    <header className="devices-heading"><div><span>GOODS RECEIVED</span><h2 id="goods-supplier-title">Add Supplier</h2></div><button type="button" className="devices-refresh" aria-label="Close Add Supplier" disabled={locked} onClick={onClose}><X /></button></header>
    <p>Save this supplier for the selected outlet. Short Name and Search Code are unavailable in the existing supplier format.</p>
    <form onSubmit={event => {
      event.preventDefault();
      void saveSupplier();
    }}>
      <div className="goods-supplier-form-grid">
        {field('name', 'Name', true)}{field('contact', 'Mobile', true, 'tel')}{field('shortName', 'Short Name')}
        {field('searchCode', 'Search Code')}{field('alternateNumbers', 'Alternate Numbers', false, 'tel')}{field('email', 'Email', false, 'email')}
        {field('gstIn', 'GST IN')}{field('address', 'Address')}
      </div>
      {error && <p role="alert" className="stock-error">{error}</p>}
      {uncertain && <p role="status">The save outcome is uncertain. Retry to confirm this supplier without creating a duplicate.</p>}
      <div className="goods-actions"><button type="button" className="devices-refresh" disabled={locked} onClick={onClose}>Cancel</button><button type="submit" className="stock-primary" disabled={saving}>{saving ? 'Saving…' : uncertain ? 'Retry supplier save' : 'Save Supplier'}</button></div>
    </form>
  </dialog>;
}
