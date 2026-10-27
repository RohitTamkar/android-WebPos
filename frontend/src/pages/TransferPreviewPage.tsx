import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Database, LoaderCircle } from 'lucide-react';
import { AuthenticatedImagePreview } from './AuthenticatedImagePreview.tsx';
import { masterImageUrl, productImageReference } from './imageApi.ts';
import { proposeCategoryNumbers, proposeProductCodes } from './transferNumberProposals.ts';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './DevicesPage.css';
import './TransferPreviewPage.css';

interface Category { id: string; name: string; regionalName?: string; dayType?: string; categoryNo: number | null; imagePath?: string }
interface Product { documentId: string; fields: Record<string, unknown> }
interface TransferResult { created: number; unchanged: number; skipped: number; items: { type: string; sourceId: string; name: string; status: string; reason: string; destinationNumber?: number }[] }
type Mode = 'categories' | 'products';
type TransferOptions = { stock: boolean; weighable: boolean; images: boolean; taxes: boolean; prices: boolean; barcode: boolean };
// Images were always copied before these options existed, so that remains the default.
const defaultOptions: TransferOptions = { stock: false, weighable: false, images: true, taxes: false, prices: false, barcode: false };
const transferOptions: [keyof TransferOptions, string][] = [
  ['stock', 'Stock'], ['weighable', 'Weighable'], ['images', 'Images'], ['taxes', 'Assigned Taxes'], ['prices', 'Prices'], ['barcode', 'Barcode'],
];
const fields = [
  ['name', 'Product Name'], ['regionalName', 'Regional Name'], ['shortName', 'Short Name'],
  ['category', 'Category mapping'], ['price', 'Selling / Default Price'], ['mrpPrice', 'MRP Price'],
  ['costPrice', 'Purchase Price'], ['taxIndex', 'Tax Index'], ['unitId', 'Unit ID'], ['hsnCode', 'HSN Code'],
  ['barcode', 'Barcode'], ['discount', 'Discount (%)'], ['stockable', 'Stockable'], ['weighable', 'Weighable'],
] as const;
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : 'Unavailable';
const normalized = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().toLowerCase() : '';
function defaultPrice(product: Product) {
  try {
    const table: unknown = typeof product.fields.priceTable === 'string' ? JSON.parse(product.fields.priceTable) : null;
    return table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, unknown>)['default price'] : undefined;
  } catch { return undefined; }
}
function available(product: Product, key: string) {
  const value = product.fields[key];
  if (key === 'stockable' || key === 'weighable') return typeof value === 'boolean';
  if (['price', 'mrpPrice', 'costPrice', 'taxIndex', 'unitId', 'discount'].includes(key)) return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'string';
}

// Preview data is loaded through existing authenticated GET APIs.
function usePreviewRead<T>(url: string | null, token: string, onSessionExpired: () => void) {
  const [attempt, setAttempt] = useState(0);
  const key = `${url}:${token}:${attempt}`;
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string }>({ key: '', data: null, loading: true, error: '' });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        const result = await response.json() as { success?: boolean; data?: T; message?: string };
        if (!response.ok || result.success !== true || result.data == null) throw new Error(result.message || 'Unable to load transfer data.');
        if (!controller.signal.aborted) setState({ key, data: result.data, loading: false, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, data: null, loading: false, error: error instanceof Error ? error.message : 'Unable to load transfer data.' });
      }
    })();
    return () => controller.abort();
  }, [url, token, key, onSessionExpired]);
  return { ...(url && state.key === key ? state : { data: null, loading: !!url, error: '' }), retry: () => setAttempt(value => value + 1) };
}

export function TransferPreviewPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const [grant, setGrant] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('categories');
  const [destinationId, setDestinationId] = useState('');
  const [pendingDestinationId, setPendingDestinationId] = useState('');
  const outlets = usePreviewRead<{ outlets: OutletSummary[] }>('/api/auth/outlets', token, onSessionExpired);
  const destinations = outlets.data?.outlets.filter(item => item.id !== outlet.id) ?? [];
  const destination = destinations.find(item => item.id === destinationId);
  const pendingDestination = destinations.find(item => item.id === pendingDestinationId);
  return <section className="devices-page transfer-preview" aria-label="Category and product transfer">
    <div className="devices-heading"><div><span>MASTERS</span><h1><Database size={24} /> Category &amp; Product Transfer</h1>
      <p>Copy selected categories and products to another outlet. Source records are retained.</p></div></div>
    <div className="transfer-preview-controls">
      <p><strong>Source outlet:</strong> {outlet.name}</p>
      {!destination && <h2>Choose a destination outlet</h2>}
      {outlets.loading ? <p role="status">Loading authorized destination outlets…</p> : outlets.error ?
        <div><p role="alert">{outlets.error}</p><button type="button" className="devices-refresh" onClick={outlets.retry}>Retry outlets</button></div> : !destinations.length ?
        <p>No other authorized outlets are available for transfer.</p> : !destination ? <div className="transfer-preview-outlets" aria-label="Destination outlets">
          {destinations.map(item => <button key={item.id} type="button" className="devices-refresh" aria-label={`Select outlet ${item.name}`} onClick={() => setPendingDestinationId(item.id)}>
            <span><strong>{item.name}</strong>{item.branch && <small>{item.branch}</small>}{item.active === false && <small>Inactive</small>}</span><span>Select outlet →</span>
          </button>)}
        </div> : <label>Destination outlet<select disabled={busy} value={destination.id} onChange={event => { if (event.target.value) setPendingDestinationId(event.target.value); else setDestinationId(''); }}>
          <option value="">Choose destination outlet</option>{destinations.map(item => <option key={item.id} value={item.id}>{item.name}{item.branch ? ` · ${item.branch}` : ''}{item.active === false ? ' (Inactive)' : ''}</option>)}
        </select></label>}
      {destination && <><button type="button" className="devices-refresh" disabled={busy} onClick={() => { setDestinationId(''); }}>Back to outlets</button>
        <div role="group" aria-label="Transfer type">{(['categories', 'products'] as const).map(value =>
          <button key={value} type="button" className="devices-refresh" disabled={busy} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'categories' ? 'Category Transfer' : 'Product Transfer'}</button>)}</div></>}
    </div>
    {pendingDestination && <QuickPinDialog key={`${outlet.id}:${pendingDestination.id}:${token}`} sourceId={outlet.id} destination={pendingDestination} token={token} onSessionExpired={onSessionExpired}
      onCancel={() => setPendingDestinationId('')} onVerified={authorization => { setGrant(authorization); setDestinationId(pendingDestination.id); setPendingDestinationId(''); }} />}
    {destination && <OutletPreview key={`${outlet.id}:${destination.id}:${mode}:${token}`} source={outlet} destination={destination} mode={mode} token={token} grant={grant} busy={busy} onBusy={setBusy} onAuthExpired={() => { setGrant(''); setPendingDestinationId(destination.id); }} onSessionExpired={onSessionExpired} />}
    {busy && <TransferProgress mode={mode} />}
  </section>;
}

function TransferProgress({ mode }: { mode: Mode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="transfer-preview-pin transfer-progress" aria-modal="true"
    aria-labelledby="transfer-progress-title" aria-describedby="transfer-progress-description"
    onCancel={event => event.preventDefault()}>
    <div role="status">
      <LoaderCircle className="transfer-progress-spinner" size={42} aria-hidden="true" />
      <h2 id="transfer-progress-title">{mode === 'categories' ? 'Transferring categories and products…' : 'Transferring products…'}</h2>
      <p id="transfer-progress-description">Please wait while the selected items are copied.</p>
    </div>
  </dialog>;
}

function QuickPinDialog({ sourceId, destination, token, onSessionExpired, onCancel, onVerified }: {
  sourceId: string; destination: OutletSummary; token: string; onSessionExpired: () => void; onCancel: () => void; onVerified: (grant: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => request.current?.abort(); }, []);
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(sourceId)}/transfer-preview/verify-quick-pin`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ destinationOutletId: destination.id, quickPin: pin }),
      });
      setPin('');
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; data?: { verified?: boolean; destinationOutletId?: string; transferToken?: string }; message?: string };
      if (!response.ok || result.success !== true || result.data?.verified !== true || result.data.destinationOutletId !== destination.id || !result.data.transferToken) throw new Error(result.message || 'Unable to verify your QuickPin.');
      if (!controller.signal.aborted) onVerified(result.data!.transferToken!);
    } catch (failure) {
      if (!controller.signal.aborted) { setPin(''); setError(failure instanceof Error ? failure.message : 'Unable to verify your QuickPin.'); }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  };
  return <dialog ref={dialog} className="transfer-preview-pin" aria-labelledby="preview-pin-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <form onSubmit={event => void verify(event)}><h2 id="preview-pin-title">Verify QuickPin</h2><p>Destination: <strong>{destination.name}</strong></p>
      <label htmlFor="preview-quick-pin">Your login QuickPin<input id="preview-quick-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus required pattern="[0-9]{4,6}" minLength={4} maxLength={6}
        value={pin} disabled={busy} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      {error && <p role="alert">{error}</p>}
      <div><button type="button" className="devices-refresh" onClick={onCancel}>Cancel</button><button type="submit" className="devices-refresh" disabled={busy || !/^\d{4,6}$/.test(pin)}>{busy ? 'Verifying…' : 'Verify'}</button></div>
    </form>
  </dialog>;
}

function OutletPreview({ source, destination, mode, token, grant, busy, onBusy, onAuthExpired, onSessionExpired }: {
  source: OutletSummary; destination: OutletSummary; mode: Mode; token: string; grant: string; busy: boolean; onBusy: (busy: boolean) => void; onAuthExpired: () => void; onSessionExpired: () => void;
}) {
  const base = (id: string) => `/api/outlets/${encodeURIComponent(id)}`;
  const sourceCategories = usePreviewRead<Category[]>(`${base(source.id)}/categories`, token, onSessionExpired);
  const destinationCategories = usePreviewRead<Category[]>(`${base(destination.id)}/categories`, token, onSessionExpired);
  const sourceProducts = usePreviewRead<Product[]>(`${base(source.id)}/products`, token, onSessionExpired);
  const destinationProducts = usePreviewRead<Product[]>(`${base(destination.id)}/products`, token, onSessionExpired);
  const [search, setSearch] = useState('');
  const [rawSelected, setSelected] = useState<string[]>([]);
  const [selectedFields, setSelectedFields] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);
  const [options, setOptions] = useState<TransferOptions>(defaultOptions);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TransferResult | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const requests = [
    { label: 'source categories', ...sourceCategories }, { label: 'destination categories', ...destinationCategories },
    { label: 'source products', ...sourceProducts }, { label: 'destination products', ...destinationProducts },
  ];
  const outcome = result && <TransferOutcome result={result} destination={destination.name} open={showOutcome} onDismiss={() => setShowOutcome(false)} />;
  if (requests.some(request => request.loading || request.error)) return <div className="devices-state">
    {outcome}
    {requests.filter(request => request.loading).map(request => <p key={request.label} role="status">Loading {request.label}…</p>)}
    {requests.filter(request => request.error).map(request => <div key={request.label}><p role="alert">Unable to load {request.label}: {request.error}</p><button type="button" className="devices-refresh" onClick={request.retry}>Retry {request.label}</button></div>)}
  </div>;
  const categories = sourceCategories.data ?? [];
  const targets = destinationCategories.data ?? [];
  const products = sourceProducts.data ?? [];
  const targetProducts = destinationProducts.data ?? [];
  const categoryName = (id: unknown) => categories.find(category => category.id === id)?.name || `Unavailable (${text(id)})`;
  const query = search.trim().toLowerCase();
  // Records already in the destination (same name, or same real barcode for products) cannot be transferred again.
  const presentCategory = (category: Category | undefined) => category && normalized(category.name)
    ? targets.find(target => normalized(target.name) === normalized(category.name)) : undefined;
  const realBarcode = (value: unknown) => typeof value === 'string' && value.trim() && value.trim() !== '0' ? value.trim() : '';
  const presentProduct = (product: Product) => targetProducts.some(target => (!!normalized(product.fields.name) && normalized(target.fields.name) === normalized(product.fields.name))
    || (!!realBarcode(product.fields.barcode) && realBarcode(target.fields.barcode) === realBarcode(product.fields.barcode)));
  const isPresent = (id: string) => mode === 'categories' ? !!presentCategory(categories.find(category => category.id === id))
    : products.some(product => product.documentId === id && presentProduct(product));
  const selected = rawSelected.filter(id => !isPresent(id));
  // Product Transfer places new products in a same-named existing category instead of duplicating it.
  const mappingFor = (id: string) => categoryMappings[id] ?? (mode === 'products' ? presentCategory(categories.find(category => category.id === id))?.id : undefined);
  const rows = mode === 'categories' ? categories.filter(category => [category.name, category.regionalName, category.categoryNo].some(value => normalized(value).includes(query)))
    .map(category => ({ id: category.id, category })) : products.filter(product => [product.fields.name, product.fields.code, product.fields.barcode, categoryName(product.fields.category)].some(value => normalized(value).includes(query)))
      .map(product => ({ id: product.documentId, product }));
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const selectableRows = rows.filter(row => !isPresent(row.id));
  const allVisible = selectableRows.length > 0 && selectableRows.every(row => selected.includes(row.id));
  const chosenCategories = categories.filter(category => mode === 'categories' ? selected.includes(category.id) : products.some(product => selected.includes(product.documentId) && product.fields.category === category.id));
  const chosenProducts = products.filter(product => mode === 'categories'
    ? typeof product.fields.category === 'string' && selected.includes(product.fields.category)
    : selected.includes(product.documentId));
  const productFields = (product: Product) => selectedFields[product.documentId] ?? ['name', 'category', 'taxIndex', 'unitId'].filter(key => available(product, key));
  const categoryProposals = proposeCategoryNumbers(chosenCategories.filter(category => !mappingFor(category.id)), targets);
  const productProposals = proposeProductCodes(chosenProducts, targetProducts);
  const categoryProposal = (id: string) => categoryProposals.find(proposal => proposal.id === id);
  const productProposal = (id: string) => productProposals.find(proposal => proposal.id === id);
  const proposedNumber = (value: number | null | undefined) => value == null ? 'Unavailable' : String(value);
  const mappedName = (id: string) => mappingFor(id) ? `Existing category: ${targets.find(category => category.id === mappingFor(id))?.name}` : `New category #${proposedNumber(categoryProposal(id)?.proposed)} (estimated)`;
  const fieldValue = (product: Product, key: string) => key === 'category' ? `${categoryName(product.fields.category)} → ${mappedName(String(product.fields.category))}` : key === 'price'
    ? `${text(product.fields.price)} (price table default: ${text(defaultPrice(product))})` : text(product.fields[key]);
  const allocationErrors = [...categoryProposals, ...productProposals].filter(proposal => proposal.error);
  const presentLinked = mode === 'categories' ? chosenProducts.filter(presentProduct) : [];
  if (presentLinked.length) allocationErrors.push({ id: 'already-present', proposed: null, conflicts: [],
    error: `Already present in the destination: ${presentLinked.map(product => text(product.fields.name)).join(', ')}. Duplicates are not allowed, so this category cannot be transferred. Use Product Transfer for the other products.` });
  const transferSize = selected.length + (mode === 'categories' ? chosenProducts.length : 0);
  if (transferSize > 100) allocationErrors.push({ id: 'transfer-limit', proposed: null,
    error: 'A transfer can include at most 100 categories and products. Select fewer categories or use Product Transfer for a smaller selection.', conflicts: [] });
  const chosenCategoryMappings: Record<string, string> = {};
  for (const category of chosenCategories) {
    const destinationCategoryId = mappingFor(category.id);
    if (destinationCategoryId) chosenCategoryMappings[category.id] = destinationCategoryId;
  }
  const execute = async () => {
    if (submitting.current) return;
    submitting.current = true; onBusy(true); setConfirming(false); setError(''); setResult(null); setShowOutcome(false);
    try {
      const response = await fetch(`${base(source.id)}/master-transfer`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Transfer-Token': grant },
        body: JSON.stringify({ destinationOutletId: destination.id, mode, categoryIds: chosenCategories.map(category => category.id),
          products: chosenProducts.map(product => ({ sourceProductId: product.documentId,
            fields: mode === 'categories' ? ['name', 'category', 'taxIndex', 'unitId'] : productFields(product) })),
          categoryMappings: chosenCategoryMappings, options }),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const payload = await response.json() as { success?: boolean; data?: TransferResult; message?: string };
      if (response.status === 403) onAuthExpired();
      if (!response.ok || payload.success !== true || !Array.isArray(payload.data?.items)) throw new Error(payload.message || 'Unable to confirm transfer. Retry safely without creating duplicate copies.');
      setResult(payload.data!); setShowOutcome(true);
      sourceCategories.retry(); destinationCategories.retry();
      sourceProducts.retry(); destinationProducts.retry();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to confirm transfer.'); }
    finally { submitting.current = false; onBusy(false); }
  };
  return <div className="devices-page">
    {error && <p role="alert">{error}</p>}
    {outcome}
    <fieldset className="transfer-preview-selection" disabled={busy}>
    <div className="transfer-preview-controls"><h2>{mode === 'categories' ? 'Category Transfer' : 'Product Transfer'}</h2>
      <p><strong>{source.name}</strong> → <strong>{destination.name}</strong></p>
      <label>Search {mode}<input type="search" value={search} placeholder={`Search ${mode}…`} onChange={event => setSearch(event.target.value)} /></label>
      <label className="transfer-preview-check"><input type="checkbox" checked={allVisible} disabled={!selectableRows.length} ref={input => { if (input) input.indeterminate = !allVisible && selectableRows.some(row => selected.includes(row.id)); }}
        onChange={() => setSelected(current => allVisible ? current.filter(id => !rows.some(row => row.id === id)) : [...new Set([...current, ...selectableRows.map(row => row.id)])])} />Select all visible {mode}</label>
    </div>
    {!rows.length ? <div className="devices-state"><p>{query ? 'No matching results.' : `No source ${mode} found.`}</p></div> : <div className="devices-table-scroll"><table>
      <thead><tr><th>Select</th><th>{mode === 'categories' ? 'Category No.' : 'Source Code (reference)'}</th><th>Name</th>{mode === 'categories' ? <th>No. of Products</th> : <><th>Image</th><th>Destination number/code (estimated)</th></>}<th>{mode === 'categories' ? 'Regional Name' : 'Source Category'}</th>{mode === 'products' && <th>Source Stock</th>}</tr></thead>
      <tbody>{rows.map(row => {
        const category = 'category' in row ? row.category : null;
        const product = 'product' in row ? row.product : null;
        const name = category?.name ?? text(product?.fields.name);
        const present = isPresent(row.id);
        return <tr key={row.id} className={present ? 'transfer-row-present' : undefined}><td><input type="checkbox" aria-label={`Select ${name}`} checked={selected.includes(row.id)} disabled={present} onChange={() => toggle(row.id)} /></td>
          <td>{text(category ? category.categoryNo : product?.fields.code)}</td><td>{name}{present && <span className="transfer-present-badge">Already present</span>}</td>
          {category ? <td>{products.filter(item => item.fields.category === category.id).length}</td> : <>
            <td><AuthenticatedImagePreview alt={`${name} image`} imagePath={productImageReference(product?.fields)}
              endpoint={masterImageUrl(source.id, 'products', row.id)} token={token} onSessionExpired={onSessionExpired} /></td>
            <td>{selected.includes(row.id) ? proposedNumber(productProposal(row.id)?.proposed) : 'Assigned on transfer'}</td></>}<td>{category ? text(category.regionalName) : categoryName(product?.fields.category)}</td>
          {product && <td>{text(product.fields.currentStock)}</td>}</tr>;
      })}</tbody></table></div>}
    {mode === 'products' && chosenProducts.some(product => !categories.some(category => category.id === product.fields.category)) && <p className="transfer-preview-warning">Some selected products have an unavailable source category and have no category proposal; review is required.</p>}
    <>
      {chosenCategories.map(category => <label className="transfer-preview-controls" key={category.id}>Destination category for {category.name}
        <select value={mappingFor(category.id) ?? ''} onChange={event => setCategoryMappings(current => { const next = { ...current }; if (event.target.value) next[category.id] = event.target.value; else delete next[category.id]; return next; })}>
          <option value="">Copy as a new category</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name} · #{target.categoryNo}</option>)}
        </select></label>)}
      {mode === 'products' && chosenProducts.map(product => <section className="transfer-preview-controls" key={product.documentId} aria-label={`Fields for ${text(product.fields.name)}`}><h2>{text(product.fields.name)} — Fields to copy</h2>
        <div className="transfer-preview-fields">{fields.map(([key, label]) => <label className="transfer-preview-field" key={key}><span className="transfer-preview-check"><input type="checkbox" aria-label={`${label} for ${text(product.fields.name)}`}
          disabled={!available(product, key)} checked={available(product, key) && productFields(product).includes(key)} onChange={() => setSelectedFields(current => ({ ...current,
            [product.documentId]: productFields(product).includes(key) ? productFields(product).filter(field => field !== key) : [...productFields(product), key] }))} />{label}</span>
          <small>{available(product, key) ? fieldValue(product, key) : 'Unavailable'}</small></label>)}</div>
      </section>)}
    </>
    {allocationErrors.map(proposal => <p key={proposal.id} role="alert">{proposal.error}</p>)}
    <div className="transfer-action-bar">
      <div><strong>{mode === 'categories' ? `${selected.length} categories · ${chosenProducts.length} linked products` : `${selected.length} products`}</strong><p>{busy ? 'Transferring…' : 'Source records stay unchanged'}</p></div>
      <button type="button" className="transfer-action-button" disabled={busy || !selected.length || !!allocationErrors.length} onClick={() => { if (!grant) onAuthExpired(); else setConfirming(true); }}>{busy ? 'Transferring…' : 'Review & transfer'}<ArrowRight size={18} aria-hidden="true" /></button>
    </div>
    </fieldset>
    {confirming && <TransferConfirmation source={source.name} destination={destination.name} mode={mode}
      options={options} onOptionsChange={setOptions}
      warnings={[...categoryProposals, ...productProposals].flatMap(proposal => [...proposal.conflicts, ...(proposal.error ? [proposal.error] : [])])}
      onCancel={() => setConfirming(false)} onConfirm={() => void execute()} />}
  </div>;
}

function TransferConfirmation({ source, destination, mode, options, onOptionsChange, warnings, onCancel, onConfirm }: {
  source: string; destination: string; mode: Mode; options: TransferOptions; onOptionsChange: (options: TransferOptions) => void;
  warnings: string[]; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="transfer-preview-pin transfer-confirmation" aria-labelledby="transfer-confirmation-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="transfer-confirmation-body"><h2 id="transfer-confirmation-title">Transfer {mode === 'categories' ? 'Categories' : 'Products'}</h2>
      <p>Source outlet: <strong>{source}</strong> → Destination outlet: <strong>{destination}</strong></p>
      <fieldset className="transfer-options" aria-labelledby="transfer-options-title">
        <h3 id="transfer-options-title">Select data to transfer</h3>
        {transferOptions.map(([key, label]) => <label key={key} className="transfer-preview-check transfer-option">
          <input type="checkbox" checked={options[key]} onChange={event => onOptionsChange({ ...options, [key]: event.target.checked })} />
          <span><strong>{label}</strong></span></label>)}
      </fieldset>
      {warnings.map((warning, index) => <p className="transfer-preview-warning" key={index}>{warning}</p>)}
      <div><button type="button" className="devices-refresh" onClick={onCancel}>Cancel</button><button type="button" className="transfer-action-button" onClick={onConfirm}>Continue Transfer</button></div>
    </div>
  </dialog>;
}

function TransferOutcome({ result, destination, open, onDismiss }: {
  result: TransferResult; destination: string; open: boolean; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const title = result.created > 0 ? result.skipped > 0 ? 'Transfer partially completed' : 'Transfer successful'
    : result.skipped > 0 ? 'No items transferred' : 'Already transferred';
  const summary = `${result.created} copied · ${result.unchanged} already present · ${result.skipped} not copied`;
  return <>
    <section className="transfer-preview-controls" aria-label="Transfer result" role="status">
      <h2>{title}</h2><p>{summary}</p>
    </section>
    <dialog ref={dialog} className="transfer-preview-pin" aria-labelledby="transfer-outcome-title" onCancel={event => { event.preventDefault(); onDismiss(); }}>
      <div className="transfer-confirmation-body"><h2 id="transfer-outcome-title">{title}</h2>
        <p>Destination: <strong>{destination}</strong></p><p>{summary}</p>
        {result.unchanged > 0 && <div className="transfer-outcome-present"><strong>Already present:</strong>
          <ul>{result.items.filter(item => item.status === 'already-transferred' || item.status === 'mapped').map(item => <li key={`${item.type}:${item.sourceId}`}>
            <strong>{item.name}</strong>: {item.type === 'category' ? 'Category' : 'Product'} is already present in the destination.</li>)}</ul></div>}
        {result.skipped > 0 && <div className="transfer-outcome-skipped"><strong>Not copied:</strong>
          <ul>{result.items.filter(item => item.status === 'skipped').map(item => <li key={`${item.type}:${item.sourceId}`}><strong>{item.name}</strong>: {item.reason}</li>)}</ul></div>}
        <p>Source outlet records remain unchanged.</p>
        <div><button type="button" className="transfer-action-button" onClick={onDismiss}>OK</button></div>
      </div>
    </dialog>
  </>;
}
