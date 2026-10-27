import { useEffect, useMemo, useRef, useState } from 'react';
import './ProductTaxSettings.css';
import './ProductDiscountSettings.css';

interface Product { documentId: string; fields: Record<string, unknown> }
interface Props {
  products: Product[]; categories: { id: string; name: string }[]; outletId: string; token: string;
  onSaved: (product: Product) => void; onClose: (updatedCount?: number) => void; onSessionExpired: () => void;
}
const nameOf = (product: Product) => typeof product.fields.name === 'string' && product.fields.name.trim() ? product.fields.name : 'Unnamed product';

export function ProductDiscountSettings({ products, categories, outletId, token, onSaved, onClose, onSessionExpired }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState(() => new Set<string>());
  const [discount, setDiscount] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<{ id: string; name: string; message: string }[]>([]);
  const busy = useRef(false), savedIds = useRef(new Set<string>()), selectAll = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    return () => controller.abort();
  }, []);
  const rows = useMemo(() => [...products].sort((a, b) => String(a.fields.code ?? '').localeCompare(String(b.fields.code ?? ''), 'en', { numeric: true })), [products]);
  const visible = rows.filter(product => category === null || product.fields.category === category);
  const selectedVisible = visible.filter(product => selected.has(product.documentId)).length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  }, [selectedVisible, visible.length]);
  const toggle = (ids: string[], checked: boolean) => {
    setMessage(''); setFailures([]);
    setSelected(current => {
      const next = new Set(current);
      ids.forEach(id => { if (checked) next.add(id); else next.delete(id); });
      return next;
    });
  };
  const update = async () => {
    const controller = request.current;
    if (busy.current || !controller || controller.signal.aborted) return;
    const value = Number(discount);
    if (!selected.size || !discount.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
      setMessage('Select products and enter a discount between 0 and 100%.'); return;
    }
    const changes = rows.filter(product => selected.has(product.documentId) && product.fields.discount !== value);
    if (!changes.length) { setMessage('Selected products already use this discount.'); return; }
    busy.current = true; setSaving(true); setMessage(''); setFailures([]);
    const queue = [...changes], failed: { id: string; name: string; message: string }[] = [];
    let expired = false, saved = 0;
    const worker = async () => {
      for (let product = queue.shift(); product && !expired && !controller.signal.aborted; product = queue.shift()) {
        try {
          const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/${encodeURIComponent(product.documentId)}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ discount: value }), signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (response.status === 401) { expired = true; return; }
          const result = await response.json() as { success?: boolean; data?: Product; message?: string };
          if (!response.ok || result.success !== true || result.data?.documentId !== product.documentId || result.data?.fields?.discount !== value) {
            throw new Error(result.message || 'Unable to confirm this product’s discount update.');
          }
          if (controller.signal.aborted) return;
          saved++; savedIds.current.add(product.documentId);
          onSaved(result.data);
          const savedId = product.documentId;
          setSelected(current => { const next = new Set(current); next.delete(savedId); return next; });
        } catch (error) {
          if (!controller.signal.aborted) failed.push({ id: product.documentId, name: nameOf(product), message: (error as Error).message || 'Unable to update this product.' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    busy.current = false;
    if (controller.signal.aborted) return;
    setSaving(false);
    if (expired) { onSessionExpired(); return; }
    if (!failed.length) { onClose(savedIds.current.size); return; }
    setFailures(failed);
    setMessage(`${saved} products updated; ${failed.length} failed. Failed products remain selected. Click Update to retry.`);
  };
  return <section className="products-page-shell product-tax-settings product-discount-settings" aria-label="Update Discount" aria-busy={saving}>
    <div className="products-header tax-settings-header">
      <div><h1>Update Discount</h1><p>{selected.size} products selected across categories.</p></div>
      <div className="tax-settings-actions">
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => onClose(savedIds.current.size)}>Cancel</button>
        <button type="button" className="btn-primary-add" disabled={saving || !selected.size || !discount.trim()} onClick={() => void update()}>{saving ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
    <div className="tax-category-tabs" role="group" aria-label="Product categories">
      <button type="button" aria-pressed={category === null} disabled={saving} onClick={() => setCategory(null)}>All</button>
      {categories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} disabled={saving} onClick={() => setCategory(item.id)}>{item.name}</button>)}
    </div>
    <div className="discount-value-field">
      <label htmlFor="bulk-product-discount">Enter Discount Value (%)</label>
      <input id="bulk-product-discount" type="number" inputMode="decimal" min="0" max="100" step="any"
        placeholder="Enter a discount from 0 to 100" value={discount} disabled={saving}
        aria-describedby="bulk-discount-help" onChange={event => { setDiscount(event.target.value); setMessage(''); setFailures([]); }} />
      <small id="bulk-discount-help">Apply this percentage to selected products. Enter 0 to remove their discount.</small>
    </div>
    {message && <p role={failures.length ? 'alert' : 'status'} className={failures.length ? 'category-form-error' : 'products-notice'}>{message}</p>}
    {failures.length > 0 && <ul className="tax-settings-failures" aria-label="Failed products">{failures.map(failure => <li key={failure.id}><strong>{failure.name}</strong>: {failure.message}</li>)}</ul>}
    <div className="products-table-card"><table className="products-table tax-settings-table" aria-label="Product discount settings">
      <thead><tr><th>Sr. no</th><th>Product Name</th><th>Discount (%)</th><th><label className="tax-select-all">Select All<input ref={selectAll} type="checkbox" aria-label="Select all displayed products"
        checked={visible.length > 0 && selectedVisible === visible.length} disabled={saving || !visible.length} onChange={event => toggle(visible.map(product => product.documentId), event.target.checked)} /></label></th></tr></thead>
      <tbody>{!visible.length && <tr><td colSpan={4} className="tax-settings-empty">No products in this category.</td></tr>}
        {visible.map((product, index) => <tr key={product.documentId}><td>{index + 1}</td><td className="products-name">{nameOf(product)}</td>
          <td>{typeof product.fields.discount === 'number' ? product.fields.discount : 0}</td>
          <td><input type="checkbox" aria-label={`Select ${nameOf(product)}`} disabled={saving} checked={selected.has(product.documentId)} onChange={event => toggle([product.documentId], event.target.checked)} /></td></tr>)}
      </tbody>
    </table></div>
  </section>;
}
