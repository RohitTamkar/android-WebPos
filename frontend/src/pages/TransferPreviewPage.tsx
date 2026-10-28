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
type TransferOptions = { stock: boolean; weighable: boolean; images: boolean; taxes: boolean; prices: boolean; barcode: boolean };
// Images were always copied before these options existed, so that remains the default.
const defaultOptions: TransferOptions = { stock: false, weighable: false, images: true, taxes: false, prices: false, barcode: false };
const transferOptions: [keyof TransferOptions, string][] = [
  ['stock', 'Stock'], ['weighable', 'Weighable'], ['images', 'Images'], ['taxes', 'Assigned Taxes'], ['prices', 'Prices'], ['barcode', 'Barcode'],
];
// Product Transfer copies these fields; prices, taxes, barcode, stock and weighable follow the confirmation options.
const productTransferFields = ['name', 'regionalName', 'shortName', 'category', 'taxIndex', 'unitId', 'discount'];
// The server accepts at most this many categories plus products per request.
const transferBatchLimit = 100;
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : 'Unavailable';
const normalized = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().toLowerCase() : '';
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
  const [destinationId, setDestinationId] = useState('');
  const [pendingDestinationId, setPendingDestinationId] = useState('');
  const outlets = usePreviewRead<{ outlets: OutletSummary[] }>('/api/auth/outlets', token, onSessionExpired);
  const destinations = outlets.data?.outlets.filter(item => item.id !== outlet.id) ?? [];
  const destination = destinations.find(item => item.id === destinationId);
  const pendingDestination = destinations.find(item => item.id === pendingDestinationId);
  return <section className="devices-page transfer-preview" aria-label="Product transfer">
    <div className="devices-heading"><div><span>MASTERS</span><h1><Database size={24} /> Product Transfer</h1>
      <p>Copy selected products and their assigned categories to another outlet.</p></div></div>
    <div className="transfer-preview-controls transfer-route-controls">
      <p className="transfer-source-outlet"><strong>Source outlet:</strong> {outlet.name}</p>
      {!destination && <h2>Choose a destination outlet</h2>}
      {outlets.loading ? <p role="status">Loading authorized destination outlets…</p> : outlets.error ?
        <div><p role="alert">{outlets.error}</p><button type="button" className="devices-refresh" onClick={outlets.retry}>Retry outlets</button></div> : !destinations.length ?
        <p>No other authorized outlets are available for transfer.</p> : !destination ? <div className="transfer-preview-outlets" aria-label="Destination outlets">
          {destinations.map(item => <button key={item.id} type="button" className="devices-refresh" aria-label={`Select outlet ${item.name}`} onClick={() => setPendingDestinationId(item.id)}>
            <span><strong>{item.name}</strong>{item.branch && <small>{item.branch}</small>}{item.active === false && <small>Inactive</small>}</span><span>Select outlet →</span>
          </button>)}
        </div> : <label className="transfer-destination-field">Destination outlet<select disabled={busy} value={destination.id} onChange={event => { if (event.target.value) setPendingDestinationId(event.target.value); else setDestinationId(''); }}>
          <option value="">Choose destination outlet</option>{destinations.map(item => <option key={item.id} value={item.id}>{item.name}{item.branch ? ` · ${item.branch}` : ''}{item.active === false ? ' (Inactive)' : ''}</option>)}
        </select></label>}
      {destination && <button type="button" className="devices-refresh transfer-back-outlets" disabled={busy} onClick={() => setDestinationId('')}>Back to outlets</button>}
    </div>
    {pendingDestination && <QuickPinDialog key={`${outlet.id}:${pendingDestination.id}:${token}`} sourceId={outlet.id} destination={pendingDestination} token={token} onSessionExpired={onSessionExpired}
      onCancel={() => setPendingDestinationId('')} onVerified={authorization => { setGrant(authorization); setDestinationId(pendingDestination.id); setPendingDestinationId(''); }} />}
    {destination && <OutletPreview key={`${outlet.id}:${destination.id}:${token}`} source={outlet} destination={destination} token={token} grant={grant} busy={busy} onBusy={setBusy} onFinished={() => setDestinationId('')} onAuthExpired={() => { setGrant(''); setPendingDestinationId(destination.id); }} onSessionExpired={onSessionExpired} />}
    {busy && <TransferProgress />}
  </section>;
}

function TransferProgress() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="transfer-preview-pin transfer-progress" aria-modal="true"
    aria-labelledby="transfer-progress-title" aria-describedby="transfer-progress-description"
    onCancel={event => event.preventDefault()}>
    <div role="status">
      <LoaderCircle className="transfer-progress-spinner" size={42} aria-hidden="true" />
      <h2 id="transfer-progress-title">Transferring products…</h2>
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

function OutletPreview({ source, destination, token, grant, busy, onBusy, onFinished, onAuthExpired, onSessionExpired }: {
  source: OutletSummary; destination: OutletSummary; token: string; grant: string; busy: boolean; onBusy: (busy: boolean) => void; onFinished: () => void; onAuthExpired: () => void; onSessionExpired: () => void;
}) {
  const base = (id: string) => `/api/outlets/${encodeURIComponent(id)}`;
  const sourceCategories = usePreviewRead<Category[]>(`${base(source.id)}/categories`, token, onSessionExpired);
  const destinationCategories = usePreviewRead<Category[]>(`${base(destination.id)}/categories`, token, onSessionExpired);
  const sourceProducts = usePreviewRead<Product[]>(`${base(source.id)}/products`, token, onSessionExpired);
  const destinationProducts = usePreviewRead<Product[]>(`${base(destination.id)}/products`, token, onSessionExpired);
  const [search, setSearch] = useState('');
  const [rawSelected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [options, setOptions] = useState<TransferOptions>(defaultOptions);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TransferResult | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);
  // After a complete transfer, closing the result returns to the outlet list; a partial one stays here to retry.
  const [complete, setComplete] = useState(false);
  const submitting = useRef(false);
  const requests = [
    { label: 'source categories', ...sourceCategories }, { label: 'destination categories', ...destinationCategories },
    { label: 'source products', ...sourceProducts }, { label: 'destination products', ...destinationProducts },
  ];
  const outcome = result && <TransferOutcome result={result} destination={destination.name} open={showOutcome} onDismiss={() => { setShowOutcome(false); if (complete) onFinished(); }} />;
  if (requests.some(request => request.loading || request.error)) return <div className="devices-state">
    {outcome}
    {requests.filter(request => request.loading).map(request => <p key={request.label} role="status">Loading {request.label}…</p>)}
    {requests.filter(request => request.error).map(request => <div key={request.label}><p role="alert">Unable to load {request.label}: {request.error}</p><button type="button" className="devices-refresh" onClick={request.retry}>Retry {request.label}</button></div>)}
  </div>;
  const categories = sourceCategories.data ?? [];
  const targets = destinationCategories.data ?? [];
  const products = sourceProducts.data ?? [];
  const targetProducts = destinationProducts.data ?? [];
  // Products with no category (or a deleted one) are transferred without a category and listed under All.
  const categoryName = (id: unknown) => categories.find(category => category.id === id)?.name || 'All';
  const query = search.trim().toLowerCase();
  // Records already in the destination (same name, or same real barcode for products) cannot be transferred again.
  const presentCategory = (category: Category | undefined) => category && normalized(category.name)
    ? targets.find(target => normalized(target.name) === normalized(category.name)) : undefined;
  const realBarcode = (value: unknown) => typeof value === 'string' && value.trim() && value.trim() !== '0' ? value.trim() : '';
  const presentProduct = (product: Product) => targetProducts.some(target => (!!normalized(product.fields.name) && normalized(target.fields.name) === normalized(product.fields.name))
    || (!!realBarcode(product.fields.barcode) && realBarcode(target.fields.barcode) === realBarcode(product.fields.barcode)));
  const isPresent = (id: string) => products.some(product => product.documentId === id && presentProduct(product));
  const selected = rawSelected.filter(id => !isPresent(id));
  const mappingFor = (id: string) => presentCategory(categories.find(category => category.id === id))?.id;
  const rows = products.filter(product => [product.fields.name, product.fields.code, product.fields.barcode, categoryName(product.fields.category)].some(value => normalized(value).includes(query)))
    .map(product => ({ id: product.documentId, product }));
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const selectableRows = rows.filter(row => !isPresent(row.id));
  const allVisible = selectableRows.length > 0 && selectableRows.every(row => selected.includes(row.id));
  const chosenProducts = products.filter(product => selected.includes(product.documentId));
  const chosenCategories = categories.filter(category => chosenProducts.some(product => product.fields.category === category.id));
  const productFields = (product: Product) => productTransferFields.filter(key => available(product, key));
  const categoryProposals = proposeCategoryNumbers(chosenCategories.filter(category => !mappingFor(category.id)), targets);
  const productProposals = proposeProductCodes(chosenProducts, targetProducts);
  const productProposal = (id: string) => productProposals.find(proposal => proposal.id === id);
  const proposedNumber = (value: number | null | undefined) => value == null ? 'Unavailable' : String(value);
  const allocationErrors = [...categoryProposals, ...productProposals].filter(proposal => proposal.error);
  const chosenCategoryMappings: Record<string, string> = {};
  for (const category of chosenCategories) {
    const destinationCategoryId = mappingFor(category.id);
    if (destinationCategoryId) chosenCategoryMappings[category.id] = destinationCategoryId;
  }
  // Each product batch carries the categories its products need. Transferred category IDs are
  // deterministic, so a category created by an earlier batch is reused by later ones.
  const batches: { categories: Category[]; products: Product[] }[] = [];
  for (const product of chosenProducts) {
    const category = chosenCategories.find(item => item.id === product.fields.category);
    let batch = batches.at(-1);
    const added = 1 + (category && !batch?.categories.includes(category) ? 1 : 0);
    if (!batch || batch.categories.length + batch.products.length + added > transferBatchLimit) batches.push(batch = { categories: [], products: [] });
    if (category && !batch.categories.includes(category)) batch.categories.push(category);
    batch.products.push(product);
  }
  const execute = async () => {
    if (submitting.current) return;
    submitting.current = true; onBusy(true); setConfirming(false); setError(''); setResult(null); setShowOutcome(false); setComplete(false);
    const results: TransferResult[] = [];
    try {
      for (const batch of batches) {
        const response = await fetch(`${base(source.id)}/master-transfer`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Transfer-Token': grant },
          body: JSON.stringify({ destinationOutletId: destination.id, mode: 'products', categoryIds: batch.categories.map(category => category.id),
            products: batch.products.map(product => ({ sourceProductId: product.documentId,
              fields: productFields(product) })),
            categoryMappings: Object.fromEntries(Object.entries(chosenCategoryMappings).filter(([id]) => batch.categories.some(category => category.id === id))), options }),
        });
        if (response.status === 401) { onSessionExpired(); return; }
        const payload = await response.json() as { success?: boolean; data?: TransferResult; message?: string };
        if (response.status === 403) onAuthExpired();
        if (!response.ok || payload.success !== true || !Array.isArray(payload.data?.items)) throw new Error(payload.message || 'Unable to confirm transfer. Retry safely without creating duplicate copies.');
        results.push(payload.data!);
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to confirm transfer.';
      setError(results.length ? `${message} ${results.length} of ${batches.length} batches were transferred; retry to finish the rest.` : message);
    } finally {
      if (results.length) {
        // A category shared by several batches is reported once, with its first outcome.
        const seen = new Set<string>();
        const items = results.flatMap(result => result.items).filter(item => !seen.has(`${item.type}:${item.sourceId}`) && !!seen.add(`${item.type}:${item.sourceId}`));
        setResult({ items, created: items.filter(item => item.status === 'created').length, skipped: items.filter(item => item.status === 'skipped').length,
          unchanged: items.filter(item => item.status === 'already-transferred' || item.status === 'mapped').length });
        setComplete(results.length === batches.length); setShowOutcome(true);
        sourceCategories.retry(); destinationCategories.retry();
        sourceProducts.retry(); destinationProducts.retry();
      }
      submitting.current = false; onBusy(false);
    }
  };
  return <div className="devices-page">
    {error && <p role="alert">{error}</p>}
    {outcome}
    <fieldset className="transfer-preview-selection" disabled={busy}>
    <div className="transfer-preview-controls"><h2>Select products</h2>
      <p><strong>{source.name}</strong> → <strong>{destination.name}</strong></p>
      <p className="transfer-category-help">Assigned categories transfer automatically. Products without a category appear under All.</p>
      <label className="transfer-search-field">Search products<input type="search" value={search} placeholder="Search by name, code, barcode or category…" onChange={event => setSearch(event.target.value)} /></label>
      <label className="transfer-preview-check"><input type="checkbox" checked={allVisible} disabled={!selectableRows.length} ref={input => { if (input) input.indeterminate = !allVisible && selectableRows.some(row => selected.includes(row.id)); }}
        onChange={() => setSelected(current => allVisible ? current.filter(id => !rows.some(row => row.id === id)) : [...new Set([...current, ...selectableRows.map(row => row.id)])])} />Select all visible products</label>
    </div>
    {!rows.length ? <div className="devices-state"><p>{query ? 'No matching results.' : 'No source products found.'}</p></div> : <div className="devices-table-scroll"><table>
      <thead><tr><th>Select</th><th>Source code</th><th>Product</th><th>Image</th><th>Destination code</th><th>Assigned category</th><th>Source stock</th></tr></thead>
      <tbody>{rows.map(({ id, product }) => {
        const name = text(product.fields.name);
        const present = isPresent(id);
        return <tr key={id} className={present ? 'transfer-row-present' : undefined}>
          <td><input type="checkbox" aria-label={`Select ${name}`} checked={selected.includes(id)} disabled={present} onChange={() => toggle(id)} /></td>
          <td>{text(product.fields.code)}</td><td><strong>{name}</strong>{present && <span className="transfer-present-badge">Already present</span>}</td>
          <td><AuthenticatedImagePreview alt={`${name} image`} imagePath={productImageReference(product.fields)} endpoint={masterImageUrl(source.id, 'products', id)} token={token} onSessionExpired={onSessionExpired} /></td>
          <td>{selected.includes(id) ? proposedNumber(productProposal(id)?.proposed) : 'Assigned on transfer'}</td>
          <td>{categoryName(product.fields.category)}</td><td>{text(product.fields.currentStock)}</td>
        </tr>;
      })}</tbody></table></div>}
    {allocationErrors.map(proposal => <p key={proposal.id} role="alert">{proposal.error}</p>)}
    <div className="transfer-action-bar">
      <div><strong>{`${selected.length} products · ${chosenCategories.length} assigned categories`}</strong><p>{busy ? 'Transferring…' : 'Source records stay unchanged'}</p></div>
      <button type="button" className="transfer-action-button" disabled={busy || !selected.length || !!allocationErrors.length} onClick={() => { if (!grant) onAuthExpired(); else setConfirming(true); }}>{busy ? 'Transferring…' : 'Review & transfer'}<ArrowRight size={18} aria-hidden="true" /></button>
    </div>
    </fieldset>
    {confirming && <TransferConfirmation source={source.name} destination={destination.name}
      options={options} onOptionsChange={setOptions}
      warnings={[...categoryProposals, ...productProposals].flatMap(proposal => [...proposal.conflicts, ...(proposal.error ? [proposal.error] : [])])}
      onCancel={() => setConfirming(false)} onConfirm={() => void execute()} />}
  </div>;
}

function TransferConfirmation({ source, destination, options, onOptionsChange, warnings, onCancel, onConfirm }: {
  source: string; destination: string; options: TransferOptions; onOptionsChange: (options: TransferOptions) => void;
  warnings: string[]; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="transfer-preview-pin transfer-confirmation" aria-labelledby="transfer-confirmation-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="transfer-confirmation-body"><h2 id="transfer-confirmation-title">Transfer Products</h2>
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
