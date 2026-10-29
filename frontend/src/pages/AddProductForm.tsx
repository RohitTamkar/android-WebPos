import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createRequestId } from '../utils/requestId.ts';
import { productFormErrors, productFormPayload, productDraftFromFields, productUpdatePayload, type ProductDraft } from './productForm.ts';
import { productPremisesPrices, productPremisesPriceKey } from './productPremisesPrices.ts';
import { ANDROID_TAX_OPTIONS } from '../../../shared/androidTaxes.ts';
import { LocalImagePicker } from './LocalImagePicker.tsx';
import { masterImageUrl, productImageReference, removeMasterImage, uploadMasterImage } from './imageApi.ts';
import './CategoryPage.css';
import './AddProductForm.css';

export interface CreatedProduct { documentId: string; fields: Record<string, unknown> }
interface Options {
  code: number | string; categories: { id: string; name: string }[];
  taxes: { percent: number; index: number; type: number }[]; units: { id: number; name: string }[];
  premises?: { id: string; name: string }[];
  servicePointName?: string;
  servicePoints?: { id: string; name: string }[];
}
interface Props {
  outletId: string; token: string; initialCategory: string | null; product?: CreatedProduct;
  onCancel: () => void; onCreated: (product: CreatedProduct) => void; onSessionExpired: () => void;
}
export function AddProductForm({ outletId, token, initialCategory, onCancel, onCreated, onSessionExpired, product }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const createdForImageRetry = useRef<CreatedProduct | null>(null);
  const [requestId] = useState(createRequestId);
  const [options, setOptions] = useState<Options | null>(null);
  const originalDraft = useRef(product ? productDraftFromFields(product.fields) : null);
  const [draft, setDraft] = useState<ProductDraft>(product ? productDraftFromFields(product.fields) : { name: '', price: '', mrpPrice: '0', costPrice: '0',
    category: initialCategory ?? '', regionalName: '', discount: '0', shortName: '', taxIndex: '',
    hsnCode: '', unitId: '', weighable: false, stockable: false, wholeSaleAmount: '0', onlinePrice: '0' });
  const [storedProduct, setStoredProduct] = useState(product);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

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
        if (product) {
          const pointsResponse = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/service-points`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          });
          if (pointsResponse.status === 401) { onSessionExpired(); return; }
          const pointsResult = await pointsResponse.json() as { data?: { servicePoints: { documentId: string; name: string }[] }; message?: string };
          if (controller.signal.aborted) return;
          if (!pointsResponse.ok || !pointsResult.data) throw new Error(pointsResult.message || 'Unable to load service points.');
          config.servicePoints = pointsResult.data.servicePoints.map(point => ({ id: point.documentId, name: point.name }));
        }
        setOptions(config);
        if (product && config.product) {
          setStoredProduct(config.product);
          originalDraft.current = productDraftFromFields(config.product.fields);
          setDraft(originalDraft.current);
        } else setDraft(current => ({ ...current,
          taxIndex: current.taxIndex || '1',
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
      let saved: CreatedProduct;
      if (!product && createdForImageRetry.current) saved = createdForImageRetry.current;
      else {
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
        saved = result.data;
        if (!product && selectedImage) createdForImageRetry.current = saved;
      }
      if (selectedImage) {
        try {
          const image = await uploadMasterImage(outletId, 'products', saved.documentId, token, selectedImage, productImageReference(storedProduct?.fields) ?? null);
          const fields: Record<string, unknown> = { ...saved.fields, image }; delete fields.imagePath;
          saved = { ...saved, fields };
        } catch (imageError) {
          if ((imageError as { status?: number }).status === 401) { onSessionExpired(); return; }
          throw new Error(product
            ? `Product details were saved, but image saving could not be confirmed. Reload before retrying. ${(imageError as Error).message}`
            : `Product was created, but image saving could not be confirmed. Retry to attach it without creating another product. ${(imageError as Error).message}`);
        }
      } else if (removeImage && productImageReference(saved.fields)) {
        try { await removeMasterImage(outletId, 'products', saved.documentId, token); }
        catch (imageError) {
          if ((imageError as { status?: number }).status === 401) { onSessionExpired(); return; }
          throw new Error(`Product details were saved, but image removal could not be confirmed. Reload before retrying. ${(imageError as Error).message}`);
        }
        const fields = { ...saved.fields }; delete fields.imagePath;
        if (typeof fields.image === 'string') fields.image = null;
        saved = { ...saved, fields };
      }
      createdForImageRetry.current = null;
      onCreated(saved);
    } catch (error) { setError((error as Error).message); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const issue = (key: string) => errors[key] ? <span id={`product-${key}-error`} className="category-form-error" role="alert">{errors[key]}</span> : null;
  const text = (key: 'name' | 'price' | 'mrpPrice' | 'costPrice' | 'regionalName' | 'discount' | 'shortName' | 'hsnCode' | 'wholeSaleAmount' | 'onlinePrice' | 'barcode', label: string, numeric = false) => (
    <div className="form-field" key={key}><label htmlFor={`product-${key}`}>{label}</label>
      <input ref={key === 'name' ? nameRef : undefined} id={`product-${key}`} type={numeric ? 'number' : 'text'}
        {...(numeric ? { min: 0, step: 'any', ...(key === 'discount' ? { max: 100 } : {}) } : { maxLength: 200 })}
        disabled={saving || (!!product && !options) || (!!product && key === 'wholeSaleAmount' && draft[key] === undefined)} value={draft[key] ?? ''} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `product-${key}-error` : undefined}
        onChange={event => update(key, event.target.value)} />{issue(key)}</div>
  );
  const storedText = (key: string) => {
    const value = storedProduct?.fields[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };
  const savedDetail = (key: string, label: string) => <div className="form-field" key={key}>
    <label htmlFor={`product-${key}`}>{label}</label><input id={`product-${key}`} readOnly value={storedText(key)} placeholder="Not set" />
  </div>;
  let priceTable: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storedText('priceTable') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) priceTable = parsed as Record<string, unknown>;
  } catch { /* Preserve an unrecognized stored price table without rewriting it. */ }
  const premisePrices = productPremisesPrices(options?.premises ?? [], priceTable);
  const savedPrices = premisePrices.map(({ price }) => price).filter(price => price !== undefined);
  const allDefaultPrices = savedPrices.length > 0 && savedPrices.every(value => value === priceTable['default price']);
  const discountAmount = Number(draft.price) * Number(draft.discount) / 100;
  return (
    <section className="category-modal add-product-modal" aria-labelledby="add-product-title">
      <form noValidate onSubmit={event => void save(event)}>
        <div className="modal-header"><h3 id="add-product-title">{product ? 'Edit Product' : 'Add New Product'}</h3>
          <button type="button" className="modal-close-btn" aria-label={product ? 'Close edit product' : 'Close add product'} disabled={saving} onClick={onCancel}><X size={18} /></button></div>
        <div className="modal-body">
          <h4 className="product-section-heading">Product Details</h4>
          {error && <p className="category-form-error" role="alert">{error}</p>}
          {!options && <p role="status">{error ? <button type="button" className="btn-secondary" onClick={() => { setError(''); setOptions(null); setRetry(value => value + 1); }}>Retry loading options</button> : 'Loading product options…'}</p>}
          {text('name', 'Product Name')}
          {text('regionalName', 'Regional Name')}
          <div className="product-pricing-fields">
            {text('price', 'Selling Price', true)}
            {text('wholeSaleAmount', 'Wholesale Rate', true)}
            {text('mrpPrice', 'MRP Price', true)}
            {text('costPrice', 'Purchase Price', true)}
          </div>
          <label className="product-checkbox product-wide"><input type="checkbox" checked={allDefaultPrices} disabled />Default price set to all premises</label>
          {text('onlinePrice', 'Online Price', true)}
          {premisePrices.map(({ name, label, price }) => {
            const key = productPremisesPriceKey(name, priceTable);
            return <div className="form-field" key={name}><label>{label}
              <input aria-label={label} type="number" min="0" step="any" readOnly={!product} disabled={saving || !options}
                aria-invalid={!!errors[`premises:${key}`] || !!errors.premisesPrices}
                value={draft.premisesPrices?.[key] ?? (typeof price === 'number' || typeof price === 'string' ? String(price) : '')}
                placeholder={`Default: ${draft.price || '0'}`} onChange={event => update('premisesPrices', { ...draft.premisesPrices, [key]: event.target.value })} /></label>
              {issue(`premises:${key}`)}</div>;
          })}
          {issue('premisesPrices')}
          <div className="form-field"><label htmlFor="product-code">Search Code</label><input id="product-code" readOnly value={options?.code ?? storedText('code')} placeholder="Loading…" /></div>
          {product ? text('barcode', 'Barcode') : savedDetail('barcode', 'Barcode')}
          <fieldset className="product-inventory product-wide"><legend>Track inventory for this item</legend>
            <label className="product-checkbox"><input type="checkbox" aria-label="Stockable" checked={draft.stockable} disabled={saving || (!!product && !options)} onChange={event => update('stockable', event.target.checked)} />Stockable</label>
          </fieldset>
          <div className="form-field"><label htmlFor="product-category">Category</label>
            <select id="product-category" disabled={saving || !options} value={draft.category} aria-invalid={!!errors.category} aria-describedby={errors.category ? 'product-category-error' : undefined} onChange={event => update('category', event.target.value)}>
              <option value="">Select Category</option>{options?.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              {options && draft.category && !options.categories.some(category => category.id === draft.category) && <option value={draft.category}>Deleted category</option>}
            </select>{issue('category')}
            {options && !options.categories.length && <span className="category-form-error">Add a category in Category Master first.</span>}
          </div>
              <div className="form-field"><label htmlFor="product-taxIndex">Tax</label>
                <select id="product-taxIndex" disabled={saving || !options} value={draft.taxIndex} aria-invalid={!!errors.taxIndex} aria-describedby={errors.taxIndex ? 'product-taxIndex-error' : undefined} onChange={event => update('taxIndex', event.target.value)}>
                  <option value="">Select Tax</option>{ANDROID_TAX_OPTIONS.map(tax => <option key={tax.index} value={tax.index}>{tax.name}</option>)}
                  {draft.taxIndex && !ANDROID_TAX_OPTIONS.some(tax => String(tax.index) === draft.taxIndex)
                    && <option value={draft.taxIndex}>Saved tax ({draft.taxIndex})</option>}
                </select>{issue('taxIndex')}
              </div>
              <div className="form-field"><label htmlFor="product-unitId">Unit Type</label>
                <select id="product-unitId" disabled={saving || !options} value={draft.unitId} aria-invalid={!!errors.unitId} aria-describedby={errors.unitId ? 'product-unitId-error' : undefined} onChange={event => update('unitId', event.target.value)}>
                  <option value="">Select Unit Type</option>{options?.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>{issue('unitId')}
              </div>
          <div className="form-field"><label htmlFor="product-kitchenId">Service Point</label>
            {product ? <select id="product-kitchenId" disabled={saving || !options} value={draft.kitchenId ?? ''}
              aria-invalid={!!errors.kitchenId} onChange={event => update('kitchenId', event.target.value)}>
              <option value="">Not set</option>
              {options?.servicePoints?.map(point => <option key={point.id} value={point.id}>{point.name}</option>)}
              {draft.kitchenId && options && !options.servicePoints?.some(point => point.id === draft.kitchenId)
                && <option value={draft.kitchenId}>Service point unavailable</option>}
            </select> : <input id="product-kitchenId" readOnly value="" placeholder="Not set" />}
            {issue('kitchenId')}
          </div>
          <div className="form-field"><label htmlFor="product-variant">Variant</label><input id="product-variant" disabled value="" placeholder="Not configured" /></div>
          <div className="form-field"><label htmlFor="product-addon">Addon</label><input id="product-addon" disabled value="" placeholder="Not configured" /></div>
          <div className="form-field product-wide"><label htmlFor="product-recipeId">Select Recipe</label><div className="product-recipe-field"><input id="product-recipeId" readOnly value={storedText('recipeId')} placeholder="No recipe selected" /><button type="button" className="btn-secondary" disabled>Add Recipe</button></div></div>
          <h4 className="product-section-heading product-section-heading-more">More Details</h4>
          {text('hsnCode', 'HSN Code')}
          <div className="product-flag-fields">
            <label className="product-checkbox"><input type="checkbox" aria-label="Weighable" checked={draft.weighable} disabled={saving || (!!product && !options)} onChange={event => update('weighable', event.target.checked)} />Weighable</label>
            <label className="product-checkbox"><input type="checkbox" checked={false} disabled />Rent</label>
          </div>
          {text('shortName', 'Short Name')}
          {text('discount', 'Discount (%)', true)}
          <div className="form-field"><label htmlFor="product-discountAmount">Discount (Amount)</label><input id="product-discountAmount" readOnly value={Number.isFinite(discountAmount) ? String(Math.round(discountAmount * 100) / 100) : ''} /></div>
          <h4 className="product-section-heading product-section-heading-more">Upload Product Image</h4>
          <LocalImagePicker cropProductImage id="product-image" label="Product image"
            existingImagePath={productImageReference(storedProduct?.fields)}
            imageEndpoint={product ? masterImageUrl(outletId, 'products', product.documentId) : undefined}
            token={token} onSelectedFile={setSelectedImage} onRemoveExisting={setRemoveImage} onSessionExpired={onSessionExpired}
            disabled={saving || (!!product && !options)} />
        </div>
        <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary-add" disabled={saving || !options || !options.categories.length}>{saving ? (product ? 'Updating…' : 'Saving…') : !product && createdForImageRetry.current ? 'Retry Image Save' : product ? 'Update' : 'Save Product'}</button></div>
      </form>
    </section>
  );
}
