import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import './ProductFlagsBulkUpdate.css';
import './CategoryPage.css';

type Flag = 'stockable' | 'weighable';
type Flags = Record<Flag, boolean>;
interface FlagProduct { documentId: string; fields: Record<string, unknown> }
interface Failure { documentId: string; name: string; message: string }

const flagsOf = (product: FlagProduct): Flags => ({ stockable: product.fields.stockable === true, weighable: product.fields.weighable === true });
const productName = (product: FlagProduct) => typeof product.fields.name === 'string' && product.fields.name.trim() ? product.fields.name : 'Unnamed product';
const codeText = (product: FlagProduct) => typeof product.fields.code === 'string' || typeof product.fields.code === 'number' ? String(product.fields.code) : '';
const CONCURRENCY = 4;

function HeaderCheckbox({ label, checked, indeterminate, disabled, onChange }: {
  label: string; checked: boolean; indeterminate: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.indeterminate = indeterminate; }, [indeterminate]);
  return <label className="flags-heading"><input ref={box} type="checkbox" aria-label={`Select ${label} for all products`} checked={checked}
    disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}</label>;
}

// Saves only changed stockable/weighable flags through the existing per-product PATCH endpoint.
export function ProductFlagsBulkUpdate({ products, outletId, token, onClose, onSaved, onSessionExpired }: {
  products: FlagProduct[]; outletId: string; token: string; onClose: (updatedCount?: number) => void;
  onSaved: (product: FlagProduct) => void; onSessionExpired: () => void;
}) {
  const rows = useMemo(() => [...products].sort((left, right) => codeText(left).localeCompare(codeText(right), 'en', { numeric: true, sensitivity: 'base' })), [products]);
  const [search, setSearch] = useState('');
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(product => productName(product).toLowerCase().includes(query));
  }, [rows, search]);
  // Baseline follows saved values so a retry after partial failure resends only what is still pending.
  const [baseline, setBaseline] = useState(() => new Map(products.map(product => [product.documentId, flagsOf(product)])));
  const [draft, setDraft] = useState(() => new Map(products.map(product => [product.documentId, flagsOf(product)])));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<Failure[]>([]);
  const alive = useRef(true), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const changes = rows.flatMap(product => {
    const before = baseline.get(product.documentId) ?? flagsOf(product), after = draft.get(product.documentId) ?? flagsOf(product);
    const patch: Partial<Flags> = {};
    (['stockable', 'weighable'] as const).forEach(flag => { if (before[flag] !== after[flag]) patch[flag] = after[flag]; });
    return Object.keys(patch).length ? [{ product, patch }] : [];
  });
  const changedIds = new Set(changes.map(change => change.product.documentId));
  const column = (flag: Flag) => {
    const selected = rows.filter(product => (draft.get(product.documentId) ?? flagsOf(product))[flag]).length;
    return { checked: rows.length > 0 && selected === rows.length, indeterminate: selected > 0 && selected < rows.length };
  };
  const setFlag = (flag: Flag, value: boolean, documentId?: string) => {
    setMessage('');
    setDraft(current => new Map(rows.map(product => {
      const flags = current.get(product.documentId) ?? flagsOf(product);
      return [product.documentId, documentId === undefined || product.documentId === documentId ? { ...flags, [flag]: value } : flags];
    })));
  };

  const update = async () => {
    if (busy.current) return;
    if (!changes.length) { setFailures([]); setMessage('No changes to update.'); return; }
    busy.current = true; setSaving(true); setMessage(''); setFailures([]);
    const queue = [...changes], failed: Failure[] = [];
    let saved = 0, expired = false;
    const worker = async () => {
      for (let next = queue.shift(); next && !expired; next = queue.shift()) {
        const { product, patch } = next;
        try {
          const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/${encodeURIComponent(product.documentId)}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
          });
          if (response.status === 401) { expired = true; return; }
          let result: { success?: boolean; message?: string; data?: FlagProduct } | null = null;
          try { result = await response.json(); } catch { result = null; }
          if (!response.ok || result?.success !== true || !result.data) throw new Error(result?.message || 'Unable to update this product.');
          const updated = result.data;
          saved++;
          if (alive.current) setBaseline(current => new Map(current).set(product.documentId, flagsOf(updated)));
          onSaved(updated);
        } catch (error) {
          failed.push({ documentId: product.documentId, name: productName(product), message: (error as Error).message || 'Unable to update this product.' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, changes.length) }, worker));
    busy.current = false;
    if (expired) { onSessionExpired(); return; }
    if (!alive.current) return;
    setSaving(false);
    if (!failed.length) { onClose(saved); return; }
    setFailures(failed);
    setMessage(`${saved} of ${changes.length} products updated; ${failed.length} failed. Your unsaved selections for the failed products are kept — review and click Update to try again.`);
  };

  const cancel = () => {
    if (saving) return;
    if (changes.length && !window.confirm('Discard unsaved Stockable & Weighable changes?')) return;
    onClose();
  };

  const stock = column('stockable'), weigh = column('weighable');
  const failedIds = new Map(failures.map(failure => [failure.documentId, failure.message]));
  return <section className="products-page-shell product-flags-bulk" aria-label="Update Stockable & Weighable" aria-busy={saving}>
    <div className="products-header flags-header">
      <div>
        <h1>Update Stockable &amp; Weighable</h1>
        <p>{changes.length ? `${changes.length} ${changes.length === 1 ? 'product has' : 'products have'} unsaved changes.` : 'Select the products to mark as stockable or weighable.'}</p>
      </div>
      <div className="flags-header-actions">
        <button type="button" className="btn-secondary" disabled={saving} onClick={cancel}>Cancel</button>
        <button type="button" className="btn-primary-add" disabled={saving || !rows.length} onClick={() => void update()}>{saving ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
    {message && <p className={failures.length ? 'category-form-error' : 'products-notice'} role={failures.length ? 'alert' : 'status'}>{message}</p>}
    {failures.length > 0 && <ul className="flags-failures" aria-label="Failed products">
      {failures.map(failure => <li key={failure.documentId}><strong>{failure.name}</strong>: {failure.message}</li>)}
    </ul>}
    <label className="products-search flags-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" aria-label="Search Product" placeholder="Search Product" value={search}
        onChange={event => setSearch(event.target.value)} />
    </label>
    <div className="products-table-card">
      <table className="products-table flags-table" aria-label="Product stockable and weighable settings">
        <thead><tr>
          <th>Product Name</th>
          <th className="flags-column"><HeaderCheckbox label="Stock" {...stock} disabled={saving || !rows.length} onChange={value => setFlag('stockable', value)} /></th>
          <th className="flags-column"><HeaderCheckbox label="Weighable" {...weigh} disabled={saving || !rows.length} onChange={value => setFlag('weighable', value)} /></th>
        </tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={3} className="flags-empty">No products found for this outlet.</td></tr>}
          {rows.length > 0 && !visibleRows.length && <tr><td colSpan={3} className="flags-empty">No products match your search.</td></tr>}
          {visibleRows.map(product => {
            const flags = draft.get(product.documentId) ?? flagsOf(product), name = productName(product), error = failedIds.get(product.documentId);
            return <tr key={product.documentId} className={`${changedIds.has(product.documentId) ? 'changed' : ''}${error ? ' failed' : ''}`}>
              <td className="products-name">{name}
                {error && <span className="flags-row-error">{error}</span>}</td>
              <td className="flags-column"><input type="checkbox" aria-label={`Stock for ${name}`} checked={flags.stockable} disabled={saving}
                onChange={event => setFlag('stockable', event.target.checked, product.documentId)} /></td>
              <td className="flags-column"><input type="checkbox" aria-label={`Weighable for ${name}`} checked={flags.weighable} disabled={saving}
                onChange={event => setFlag('weighable', event.target.checked, product.documentId)} /></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
