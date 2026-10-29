import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import './ProductFlagsBulkUpdate.css';
import './ProductPriceBulkUpdate.css';
import './CategoryPage.css';

interface PriceProduct { documentId: string; fields: Record<string, unknown> }
interface Failure { documentId: string; name: string; message: string }
type Prices = Record<string, unknown>;

const DEFAULT_KEY = 'default price';
const CONCURRENCY = 4;
const productName = (product: PriceProduct) => typeof product.fields.name === 'string' && product.fields.name.trim() ? product.fields.name : 'Unnamed product';
const codeText = (product: PriceProduct) => typeof product.fields.code === 'string' || typeof product.fields.code === 'number' ? String(product.fields.code) : '';
const priceText = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? String(value) : '';
const columnLabel = (key: string) => key === DEFAULT_KEY ? 'Default Price' : key.replace(/\s+price$/i, '').trim() || key;

// Android stores premise prices in priceTable (a JSON string) keyed like "AC Table price".
function priceTableOf(product: PriceProduct): Prices | null {
  let table: unknown = product.fields.priceTable;
  if (typeof table === 'string') { try { table = JSON.parse(table); } catch { return null; } }
  return table && typeof table === 'object' && !Array.isArray(table) ? table as Prices : null;
}
const textsOf = (table: Prices) => Object.fromEntries(Object.entries(table).map(([key, value]) => [key, priceText(value)]));
const validPrice = (text: string) => /^\d+(\.\d+)?$/.test(text.trim()) && Number(text) <= 1e9;
const allSame = (texts: Record<string, string>) => {
  const values = Object.values(texts);
  return values.length > 1 && values.every(value => value.trim() !== '' && Number(value) === Number(texts[DEFAULT_KEY]));
};

// Saves only changed priceTable values through the dedicated per-product prices endpoint.
export function ProductPriceBulkUpdate({ products, outletId, token, onClose, onSaved, onSessionExpired }: {
  products: PriceProduct[]; outletId: string; token: string; onClose: (updatedCount?: number) => void;
  onSaved: (product: PriceProduct) => void; onSessionExpired: () => void;
}) {
  const [premises, setPremises] = useState<string[]>([]);
  const [premisesError, setPremisesError] = useState('');
  const [premisesReload, setPremisesReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setPremisesError('');
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/premises`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (response.status === 401) { onSessionExpired(); return; }
        const result = await response.json() as { success?: boolean; data?: { premises: { fields: { name?: unknown } }[] }; message?: string };
        if (!response.ok || !result.success || !Array.isArray(result.data?.premises)) throw new Error(result.message || 'Unable to load premises.');
        if (!controller.signal.aborted) setPremises(result.data.premises.flatMap(row => typeof row.fields.name === 'string' && row.fields.name.trim() ? [row.fields.name.trim()] : []));
      } catch (error) { if (!controller.signal.aborted) setPremisesError((error as Error).message); }
    })();
    return () => controller.abort();
  }, [outletId, token, onSessionExpired, premisesReload]);
  const rows = useMemo(() => [...products].sort((left, right) => codeText(left).localeCompare(codeText(right), 'en', { numeric: true, sensitivity: 'base' })), [products]);
  const columns = useMemo(() => {
    const keys = new Set<string>([DEFAULT_KEY]);
    const normalize = (key: string) => key.trim().replace(/\s+/g, ' ').toLowerCase();
    // Prices saved for a deleted premise stay stored but get no column.
    const current = new Set(premises.flatMap(name => [normalize(name), normalize(/\bprice$/i.test(name) ? name : `${name} price`)]));
    rows.forEach(product => Object.keys(priceTableOf(product) ?? {}).forEach(key => { if (current.has(normalize(key))) keys.add(key); }));
    premises.forEach(name => {
      const key = /\bprice$/i.test(name) ? name : `${name} price`;
      if (![...keys].some(saved => normalize(saved) === normalize(key))) keys.add(key);
    });
    return [...keys];
  }, [rows, premises]);
  const [search, setSearch] = useState('');
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(product => productName(product).toLowerCase().includes(query) || codeText(product).toLowerCase().includes(query));
  }, [rows, search]);
  // Baseline holds the stored values; it follows each save so a retry resends only what is still pending.
  const [baseline, setBaseline] = useState(() => new Map(products.flatMap(product => { const table = priceTableOf(product); return table ? [[product.documentId, table] as const] : []; })));
  const [draft, setDraft] = useState(() => new Map([...baseline].map(([id, table]) => [id, textsOf(table)])));
  const [linked, setLinked] = useState(() => new Map([...draft].map(([id, texts]) => [id, allSame(texts)])));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<Failure[]>([]);
  const alive = useRef(true), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const changes = rows.flatMap(product => {
    const before = baseline.get(product.documentId), texts = draft.get(product.documentId);
    if (!before || !texts) return [];
    const keys = Object.keys(texts).filter(key => texts[key] !== priceText(before[key]));
    return keys.length ? [{ product, keys, texts, before }] : [];
  });
  const invalid = changes.filter(change => change.keys.some(key => !validPrice(change.texts[key]!)));
  const changedIds = new Set(changes.map(change => change.product.documentId));
  const invalidIds = new Set(invalid.map(change => change.product.documentId));

  const edit = (documentId: string, key: string, text: string) => {
    setMessage('');
    if (key !== DEFAULT_KEY) setLinked(current => new Map(current).set(documentId, false));
    setDraft(current => {
      const texts = { ...current.get(documentId)!, [key]: text };
      if (key === DEFAULT_KEY && linked.get(documentId) && columns.every(column => column in current.get(documentId)!)) columns.forEach(other => { texts[other] = text; });
      return new Map(current).set(documentId, texts);
    });
  };
  const link = (documentId: string, value: boolean) => {
    setMessage('');
    setLinked(current => new Map(current).set(documentId, value));
    if (value) setDraft(current => {
      const texts = { ...current.get(documentId)! };
      const product = rows.find(row => row.documentId === documentId)!;
      const value = texts[DEFAULT_KEY] ?? priceText(product.fields.price);
      columns.forEach(key => { texts[key] = value; });
      return new Map(current).set(documentId, texts);
    });
  };

  const update = async () => {
    if (busy.current) return;
    if (!changes.length) { setFailures([]); setMessage('No price changes to update.'); return; }
    if (invalid.length) { setFailures([]); setMessage(`Enter valid prices of zero or more for ${invalid.map(change => productName(change.product)).join(', ')}.`); return; }
    busy.current = true; setSaving(true); setMessage(''); setFailures([]);
    const queue = [...changes], failed: Failure[] = [];
    let saved = 0, expired = false;
    const worker = async () => {
      for (let next = queue.shift(); next && !expired; next = queue.shift()) {
        const { product, keys, texts, before } = next;
        try {
          const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/${encodeURIComponent(product.documentId)}/prices`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prices: Object.fromEntries(keys.map(key => [key, Number(texts[key])])), expected: Object.fromEntries(keys.map(key => [key, Object.hasOwn(before, key) ? before[key] : null])) }),
          });
          if (response.status === 401) { expired = true; return; }
          let result: { success?: boolean; message?: string; data?: PriceProduct } | null = null;
          try { result = await response.json(); } catch { result = null; }
          if (!response.ok || result?.success !== true || !result.data) throw new Error(result?.message || 'Unable to update prices for this product.');
          const updated = result.data, table = priceTableOf(updated);
          saved++;
          if (alive.current && table) {
            setBaseline(current => new Map(current).set(product.documentId, table));
            setDraft(current => new Map(current).set(product.documentId, { ...current.get(product.documentId), ...Object.fromEntries(keys.map(key => [key, priceText(table[key])])) }));
          }
          onSaved(updated);
        } catch (error) {
          failed.push({ documentId: product.documentId, name: productName(product), message: (error as Error).message || 'Unable to update prices for this product.' });
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
    setMessage(`${saved} of ${changes.length} products updated; ${failed.length} failed. Prices for the failed products are kept — review and click Update to try again.`);
  };

  const cancel = () => {
    if (saving) return;
    if (changes.length && !window.confirm('Discard unsaved price changes?')) return;
    onClose();
  };

  const failedIds = new Map(failures.map(failure => [failure.documentId, failure.message]));
  return <section className="products-page-shell product-flags-bulk product-price-bulk" aria-label="Update Bulk Price" aria-busy={saving}>
    <div className="products-header flags-header">
      <div>
        <h1>Update Bulk Price</h1>
        <p>{changes.length ? `${changes.length} ${changes.length === 1 ? 'product has' : 'products have'} unsaved price changes.` : 'Edit default and premises prices, then click Update.'}</p>
      </div>
      <div className="flags-header-actions">
        <button type="button" className="btn-secondary" disabled={saving} onClick={cancel}>Cancel</button>
        <button type="button" className="btn-primary-add" disabled={saving || !rows.length} onClick={() => void update()}>{saving ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
    {premisesError && <p role="alert" className="category-form-error">{premisesError} <button type="button" className="btn-secondary" onClick={() => setPremisesReload(value => value + 1)}>Retry premises</button></p>}
    {message && <p className={failures.length || invalid.length ? 'category-form-error' : 'products-notice'} role={failures.length || invalid.length ? 'alert' : 'status'}>{message}</p>}
    {failures.length > 0 && <ul className="flags-failures" aria-label="Failed products">
      {failures.map(failure => <li key={failure.documentId}><strong>{failure.name}</strong>: {failure.message}</li>)}
    </ul>}
    <label className="products-search flags-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" aria-label="Search Product" placeholder="Search Product" value={search} onChange={event => setSearch(event.target.value)} />
    </label>
    <div className="products-table-card">
      <table className="products-table price-table" aria-label="Product premises prices">
        <thead><tr>
          <th className="price-name-column">Product Name</th>
          <th className="price-same-column">Same for all</th>
          {columns.map(key => <th key={key} className="price-column">{columnLabel(key)}</th>)}
        </tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={columns.length + 2} className="flags-empty">No products found for this outlet.</td></tr>}
          {rows.length > 0 && !visibleRows.length && <tr><td colSpan={columns.length + 2} className="flags-empty">No products match your search.</td></tr>}
          {visibleRows.map(product => {
            const name = productName(product), texts = draft.get(product.documentId), same = linked.get(product.documentId) === true && !!texts && columns.every(key => key in texts);
            const error = failedIds.get(product.documentId);
            return <tr key={product.documentId} className={`${changedIds.has(product.documentId) ? 'changed' : ''}${error || invalidIds.has(product.documentId) ? ' failed' : ''}`}>
              <td className="products-name price-name-column">{name}
                {!texts && <span className="flags-row-error">Price table is invalid; edit is unavailable.</span>}
                {error && <span className="flags-row-error">{error}</span>}</td>
              <td className="price-same-column"><input type="checkbox" aria-label={`Same price for all premises for ${name}`} checked={same}
                disabled={saving || !texts || columns.length < 2} onChange={event => link(product.documentId, event.target.checked)} /></td>
              {columns.map(key => <td key={key} className="price-column">{texts
                ? <input type="text" inputMode="decimal" aria-label={`${columnLabel(key)} for ${name}`} value={texts[key] ?? ''}
                    aria-invalid={(texts[key] ?? '') !== priceText(baseline.get(product.documentId)?.[key]) && !validPrice(texts[key] ?? '')}
                    disabled={saving} onChange={event => edit(product.documentId, key, event.target.value)} />
                : <span className="price-missing" title="No saved price for this premises">—</span>}</td>)}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
