import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createRequestId } from '../utils/requestId.ts';
import { productFormErrors, productFormPayload, productDraftFromFields, productUpdatePayload, type ProductDraft } from './productForm.ts';
import './CategoryPage.css';
import './AddProductForm.css';

export interface CreatedProduct { documentId: string; fields: Record<string, unknown> }
interface Options {
  code: number | string; categories: { id: string; name: string }[];
  taxes: { percent: number; index: number; type: number }[]; units: { id: number; name: string }[];
}
interface Props {
  outletId: string; token: string; initialCategory: string | null; product?: CreatedProduct;
  onCancel: () => void; onCreated: (product: CreatedProduct) => void; onSessionExpired: () => void;
}
export function AddProductForm({ outletId, token, initialCategory, onCancel, onCreated, onSessionExpired, product }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [requestId] = useState(createRequestId);
  const [options, setOptions] = useState<Options | null>(null);
  const originalDraft = useRef(product ? productDraftFromFields(product.fields) : null);
  const [draft, setDraft] = useState<ProductDraft>(product ? productDraftFromFields(product.fields) : { name: '', price: '', mrpPrice: '0', costPrice: '0',
    category: initialCategory ?? '', regionalName: '', discount: '0', shortName: '', taxIndex: '',
    hsnCode: '', unitId: '', weighable: false, stockable: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/${product ? `${encodeURIComponent(product.documentId)}/edit-options` : 'create-options'}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (response.status === 401) { onSessionExpired(); return; }
        const result = await response.json() as { data?: Options & { product?: CreatedProduct }; message?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load product options.');
        const config = result.data;
        setOptions(config);
        if (product && config.product) {
          originalDraft.current = productDraftFromFields(config.product.fields);
          setDraft(originalDraft.current);
        } else setDraft(current => ({ ...current,
          taxIndex: current.taxIndex || (config.taxes.length === 1 ? String(config.taxes[0]!.index) : ''),
          unitId: current.unitId || (config.units.some(unit => unit.id === 2) ? '2' : config.units.length === 1 ? String(config.units[0]!.id) : ''),
        }));
        nameRef.current?.focus();
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message); }
    })();
    return () => controller.abort();
  }, [outletId, token, onSessionExpired, retry, product]);

  const update = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: '' }));
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || !options) return;
    const invalid = productFormErrors(draft);
    setErrors(invalid); setError('');
    if (Object.keys(invalid).length) return;
    savingRef.current = true; setSaving(true);
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products${product ? `/${encodeURIComponent(product.documentId)}` : ''}`, {
        method: product ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(product && originalDraft.current ? productUpdatePayload(draft, originalDraft.current) : productFormPayload(draft, Number(options.code), requestId)),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { data?: CreatedProduct; message?: string; errors?: Record<string, string>; nextCode?: number };
      if (!response.ok || !result.data) {
        if (result.nextCode !== undefined) setOptions(current => current ? { ...current, code: result.nextCode! } : current);
        if (result.errors) setErrors(result.errors);
        throw new Error(result.message || 'Unable to save product. Retry this form to reconcile the outcome.');
      }
      onCreated(result.data);
    } catch (error) { setError((error as Error).message); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const issue = (key: string) => errors[key] ? <span id={`product-${key}-error`} className="category-form-error" role="alert">{errors[key]}</span> : null;
  const text = (key: 'name' | 'price' | 'mrpPrice' | 'costPrice' | 'regionalName' | 'discount' | 'shortName' | 'hsnCode', label: string, numeric = false) => (
    <div className="form-field" key={key}><label htmlFor={`product-${key}`}>{label}</label>
      <input ref={key === 'name' ? nameRef : undefined} id={`product-${key}`} type={numeric ? 'number' : 'text'}
        {...(numeric ? { min: 0, step: 'any', ...(key === 'discount' ? { max: 100 } : {}) } : { maxLength: 200 })}
        disabled={saving || (!!product && !options)} value={draft[key]} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `product-${key}-error` : undefined}
        onChange={event => update(key, event.target.value)} />{issue(key)}</div>
  );
  return (
    <section className="category-modal add-product-modal" aria-labelledby="add-product-title">
      <form noValidate onSubmit={event => void save(event)}>
        <div className="modal-header"><h3 id="add-product-title">{product ? 'Edit Product' : 'Add New Product'}</h3>
          <button type="button" className="modal-close-btn" aria-label={product ? 'Close edit product' : 'Close add product'} disabled={saving} onClick={onCancel}><X size={18} /></button></div>
        <div className="modal-body">
          <h4 className="product-section-heading">Product Details</h4>
          {error && <p className="category-form-error" role="alert">{error}</p>}
          {!options && <p role="status">{error ? <button type="button" className="btn-secondary" onClick={() => { setError(''); setOptions(null); setRetry(value => value + 1); }}>Retry loading options</button> : 'Loading product options…'}</p>}
          <div className="form-field"><label htmlFor="product-code">Code</label><input id="product-code" readOnly value={options?.code ?? ''} /></div>
          {text('name', 'Product Name')}
          {text('price', 'Selling Price', true)}
          {text('mrpPrice', 'MRP Price', true)}
          {text('costPrice', 'Purchase Price', true)}
          <div className="form-field"><label htmlFor="product-category">Category</label>
            <select id="product-category" disabled={saving || !options} value={draft.category} aria-invalid={!!errors.category} aria-describedby={errors.category ? 'product-category-error' : undefined} onChange={event => update('category', event.target.value)}>
              <option value="">Select Category</option>{options?.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>{issue('category')}
            {options && !options.categories.length && <span className="category-form-error">Add a category in Category Master first.</span>}
          </div>
          {text('regionalName', 'Regional Name')}
          {text('discount', 'Discount (%)', true)}
          {text('shortName', 'Short Name')}
          <h4 className="product-section-heading product-section-heading-more">More Details</h4>
              <div className="form-field"><label htmlFor="product-taxIndex">Tax</label>
                <select id="product-taxIndex" disabled={saving || !options} value={draft.taxIndex} aria-invalid={!!errors.taxIndex} aria-describedby={errors.taxIndex ? 'product-taxIndex-error' : undefined} onChange={event => update('taxIndex', event.target.value)}>
                  <option value="">Select Tax</option>{options?.taxes.map((tax, index) => <option key={`${tax.index}-${index}`} value={tax.index}>{tax.percent}% GST</option>)}
                </select>{issue('taxIndex')}
                {options && !options.taxes.length && <span className="category-form-error">No supported GST taxes are configured.</span>}
              </div>
              {text('hsnCode', 'HSN')}
              <div className="form-field"><label htmlFor="product-unitId">Unit Type</label>
                <select id="product-unitId" disabled={saving || !options} value={draft.unitId} aria-invalid={!!errors.unitId} aria-describedby={errors.unitId ? 'product-unitId-error' : undefined} onChange={event => update('unitId', event.target.value)}>
                  <option value="">Select Unit Type</option>{options?.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>{issue('unitId')}
              </div>
              <label className="product-checkbox"><input type="checkbox" checked={draft.weighable} disabled={saving || (!!product && !options)} onChange={event => update('weighable', event.target.checked)} />Weighable</label>
              <label className="product-checkbox"><input type="checkbox" checked={draft.stockable} disabled={saving || (!!product && !options)} onChange={event => update('stockable', event.target.checked)} />Stockable</label>
        </div>
        <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary-add" disabled={saving || !options || !options.categories.length || !options.taxes.length}>{saving ? (product ? 'Updating…' : 'Saving…') : product ? 'Update' : 'Save Product'}</button></div>
      </form>
    </section>
  );
}
