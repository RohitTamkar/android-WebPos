import { loadProductList, ProductListRequestError } from './productListApi.ts';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Package, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './ProductsPage.css';
import { AddProductForm } from './AddProductForm.tsx';

interface ProductDocument {
  documentId: string;
  fields: Record<string, unknown>;
}

interface ProductCategory {
  id: string;
  name: string;
}

interface ProductsPageProps {
  outlet: OutletSummary;
  token: string;
  onSessionExpired: () => void;
}

function productText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

export function ProductsPage({ outlet, token, onSessionExpired }: ProductsPageProps) {
  const [products, setProducts] = useState<ProductDocument[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductDocument | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const deleteBusy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadProducts() {
      setProducts([]);
      setCategories([]);
      setSelectedCategory(null);
      setLoading(true);
      setError('');
      try {
        const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;
        const [loadedProducts, loadedCategories] = await Promise.all([
          loadProductList<ProductDocument>(`${base}/products`, token, controller.signal, 'products'),
          loadProductList<ProductCategory>(`${base}/categories`, token, controller.signal, 'categories'),
        ]);
        if (!controller.signal.aborted) {
          setProducts(loadedProducts);
          setCategories(loadedCategories);
        }
      } catch (requestError) {
        if (controller.signal.aborted) return;
        if (requestError instanceof ProductListRequestError && requestError.status === 401) { onSessionExpired(); return; }
        setError((requestError as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadProducts();
    return () => controller.abort();
  }, [outlet.id, token, reloadKey, onSessionExpired]);

  const deleteProduct = async (documentId: string) => {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true); setNotice(''); setNoticeIsError(false);
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/products/${encodeURIComponent(documentId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to delete product.');
      setProducts(current => current.filter(product => product.documentId !== documentId));
      setNotice('Product deleted successfully.');
    } catch (error) { setNoticeIsError(true); setNotice((error as Error).message); }
    finally { deleteBusy.current = false; setDeleting(false); setDeleteTarget(null); }
  };

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter(product =>
      (selectedCategory === null || product.fields.category === selectedCategory)
      && (!query || ['name', 'code', 'description'].some(field =>
        productText(product.fields[field]).toLowerCase().includes(query))));
  }, [products, selectedCategory, search]);

  if (editTarget) return <AddProductForm key={`edit-${editTarget.documentId}`} outletId={outlet.id} token={token}
    initialCategory={selectedCategory} product={editTarget} onSessionExpired={onSessionExpired}
    onCancel={() => setEditTarget(null)} onCreated={updated => {
      setProducts(current => current.map(product => product.documentId === updated.documentId ? updated : product));
      setEditTarget(null); setNoticeIsError(false); setNotice('Product updated successfully.');
    }} />;

  if (addOpen) return (<AddProductForm key={outlet.id} outletId={outlet.id} token={token} initialCategory={selectedCategory}
        onSessionExpired={onSessionExpired} onCancel={() => setAddOpen(false)} onCreated={product => {
          setProducts(current => [...current.filter(existing => existing.documentId !== product.documentId), product]);
          setAddOpen(false);
          setNoticeIsError(false);
          setNotice('Product saved successfully.');
        }} />
  );

  return (
    <section className="products-page-shell" aria-label="Products" aria-busy={loading}>
      {deleteTarget && <DeleteConfirmation kind="product" name={deleteTarget.name} busy={deleting}
        onCancel={() => { if (!deleteBusy.current) setDeleteTarget(null); }} onConfirm={() => void deleteProduct(deleteTarget.id)} />}
      <div className="products-header">
        <div>
          <h1><Package size={22} />Products</h1>
          <p>Manage your product inventory and details.</p>
        </div>
        <div className="products-header-actions">
          <button type="button" className="products-add" disabled={loading || !!error} onClick={() => { setNotice(''); setAddOpen(true); }}><Plus size={15} />Add New Product</button>
          <button type="button" className="products-refresh" disabled={loading} onClick={() => setReloadKey(value => value + 1)}>
            <RefreshCw size={15} />Refresh
          </button>
        </div>
      </div>
      {notice && <p className={noticeIsError ? 'category-form-error' : 'products-notice'} role={noticeIsError ? 'alert' : 'status'}>{notice}</p>}
      <div className="products-summary" aria-label="Product totals">
        <article className="products-summary-card">
          <span className="products-summary-icon categories"><Layers size={20} aria-hidden="true" /></span>
          <div><span className="products-summary-label">Total Categories</span><strong>{loading || error ? '—' : categories.length}</strong></div>
        </article>
        <article className="products-summary-card">
          <span className="products-summary-icon items"><Package size={20} aria-hidden="true" /></span>
          <div><span className="products-summary-label">Total Products</span><strong>{loading || error ? '—' : products.length}</strong></div>
        </article>
      </div>
      <nav className="products-category-tabs" aria-label="Product categories">
        <button type="button" className={selectedCategory === null ? 'selected' : ''}
          aria-pressed={selectedCategory === null} onClick={() => setSelectedCategory(null)}>All</button>
        {categories.map(category => (
          <button type="button" key={category.id} className={selectedCategory === category.id ? 'selected' : ''}
            aria-pressed={selectedCategory === category.id} onClick={() => setSelectedCategory(category.id)}>
            {category.name}
          </button>
        ))}
      </nav>
      <div className="products-toolbar">
        <label className="products-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search products" placeholder="Search product name, code, description…"
            value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <select aria-label="Filter by category" value={selectedCategory ?? ''}
          onChange={event => setSelectedCategory(event.target.value || null)}>
          <option value="">All Categories</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </div>
      {loading || error || visibleProducts.length === 0 ? (
        <div className="products-empty" role={error ? 'alert' : 'status'}>
          {loading ? 'Loading products…' : error || (products.length ? 'No products in this category.' : 'No products found for this outlet.')}
          {error && <button type="button" className="products-refresh" onClick={() => setReloadKey(value => value + 1)}>Retry</button>}
        </div>
      ) : (
        <div className="products-table-card" role="region" aria-label="Product list" tabIndex={0}>
          <table className="products-table">
            <thead><tr><th>Code</th><th>Product Name</th><th>Description</th><th>Sale Price</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleProducts.map(product => (
                <tr key={product.documentId}>
                  <td><span className="products-code">{productText(product.fields.code)}</span></td>
                  <td className="products-name">{productText(product.fields.name)}</td>
                  <td>{productText(product.fields.description)}</td>
                  <td><span className="products-price"><Package size={15} />₹ {productText(product.fields.price)}</span></td>
                  <td><span className="products-status">{typeof product.fields.inActive === 'boolean'
                    ? product.fields.inActive ? 'Inactive' : 'Active'
                    : typeof product.fields.active === 'boolean' ? product.fields.active ? 'Active' : 'Inactive' : '—'}</span></td>
                  <td>{productText(product.fields.createdAt)}</td>
                  <td><div className="products-row-actions">
                    <button type="button" disabled={deleting} aria-label="Edit product" title="Edit product" onClick={() => { setNotice(''); setEditTarget(product); }}><Pencil size={14} /></button>
                    <button type="button" disabled={deleting} aria-label="Delete product" title="Delete product" onClick={() => setDeleteTarget({ id: product.documentId, name: productText(product.fields.name) })}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
