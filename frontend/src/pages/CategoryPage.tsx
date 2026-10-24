import { EditCategoryForm, CategoryUpdatedPopup } from './EditCategoryForm.tsx';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { DeleteAllError, deleteAllRecords } from './deleteAllApi.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  SlidersHorizontal,
  Plus,
  Search,
  Pencil,
  Trash2,
  Package,
  CheckCircle2,
  Layers,
  FolderPlus,
  RefreshCw,
  X,
  MoreVertical,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './CategoryPage.css';

export interface Category {
  id: string;
  code: string;
  name: string;
  description: string;
  regionalName: string;
  dayType: string;
  status: 'Active' | 'Inactive' | '—';
  productCount: number;
  color: string;
  createdAt: string;
  imagePath?: string;
}

// Shape returned by GET /api/outlets/:outletId/categories (Firestore OUTLET/{id}/CATEGORY).
interface FirebaseCategory {
  id: string;
  categoryNo: number | null;
  name: string;
  regionalName: string;
  dayType: string;
  active: boolean | null;
  productCount: number;
  createdAt: string;
  imagePath?: string;
}

const PRESET_COLORS = [
  '#3567f0', // Blue
  '#11bcc3', // Cyan
  '#26a815', // Green
  '#d88900', // Amber
  '#ff343d', // Red
  '#9333ea', // Purple
  '#64748b', // Slate
];

function toCategory(category: FirebaseCategory, index: number): Category {
  return {
    id: category.id,
    code: category.categoryNo === null ? '—' : String(category.categoryNo),
    name: category.name,
    description: category.regionalName || category.dayType,
    regionalName: category.regionalName,
    dayType: category.dayType,
    status: category.active === null ? '—' : category.active ? 'Active' : 'Inactive',
    productCount: category.productCount,
    color: PRESET_COLORS[index % PRESET_COLORS.length] ?? '#3567f0',
    createdAt: category.createdAt ? category.createdAt.slice(0, 10) : '—',
    imagePath: category.imagePath,
  };
}

interface CategoryPageProps {
  outlet: OutletSummary;
  token: string;
  onSessionExpired: () => void;
}

export const CategoryPage: React.FC<CategoryPageProps> = ({ outlet, token, onSessionExpired }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Category | null>(null);
  const [updatedPopup, setUpdatedPopup] = useState(false);
  const [draft, setDraft] = useState({ name: '', regionalName: '' });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const deleteBusy = useRef(false);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deleteAllDone, setDeleteAllDone] = useState(false);

  useEffect(() => {
    if (!addOpen || saving) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAddOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [addOpen, saving]);

  // Load existing categories without modifying their Firestore documents.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/categories`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: FirebaseCategory[] };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load categories.');
        setCategories(result.data.map(toCategory));
      })
      .catch(requestError => {
        if (!controller.signal.aborted) setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, reloadKey]);

  // Filtered categories
  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return categories.filter((cat) => {
      const matchesSearch =
        cat.name.toLowerCase().includes(query) ||
        cat.code.toLowerCase().includes(query) ||
        cat.regionalName.toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'All' || cat.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [categories, searchQuery, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = categories.length;
    const active = categories.filter((c) => c.status === 'Active').length;
    const inactive = categories.filter((c) => c.status === 'Inactive').length;
    const totalItems = categories.reduce((sum, c) => sum + c.productCount, 0);
    return { total, active, inactive, totalItems };
  }, [categories]);

  const nextCategoryNumber = useMemo(() => {
    const highestNumber = categories.reduce((highest, category) => {
      const value = Number(category.code);
      return Number.isSafeInteger(value) ? Math.max(highest, value) : highest;
    }, 0);
    return highestNumber + 1;
  }, [categories]);

  const openAddCategory = () => {
    setDraft({ name: '', regionalName: '' });
    setAddError('');
    setNotice('');
    setAddOpen(true);
  };

  const deleteCategory = async (id: string) => {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true); setNotice(''); setNoticeIsError(false);
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/categories/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to delete category.');
      setCategories(current => current.filter(category => category.id !== id));
      setNotice('Category deleted successfully.');
    } catch (error) { setNoticeIsError(true); setNotice((error as Error).message); }
    finally { deleteBusy.current = false; setDeleting(false); setDeleteTarget(null); }
  };

  // Products keep their stored category field and remain listed under All on the Products page.
  const deleteAllCategories = async () => {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true); setDeleteAllError(''); setNotice('');
    try {
      await deleteAllRecords(outlet.id, token, 'categories');
      setCategories([]); setDeleteAllOpen(false); setDeleteAllDone(true);
    } catch (error) {
      if (error instanceof DeleteAllError && error.status === 401) { setDeleteAllOpen(false); onSessionExpired(); return; }
      setDeleteAllError((error as Error).message);
    } finally { deleteBusy.current = false; setDeleting(false); }
  };

  const addCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || loading || error) return;
    const categoryNo = nextCategoryNumber;
    const name = draft.name.trim();
    if (!name || !Number.isSafeInteger(categoryNo) || categoryNo <= 0) {
      setAddError('Enter a name and a positive whole category number.');
      return;
    }
    if (categories.some(category => category.code === String(categoryNo) || category.name.trim().toLowerCase() === name.toLowerCase())) {
      setAddError('A category with this number or name already exists.');
      return;
    }
    setSaving(true);
    setAddError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/categories`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryNo, name, regionalName: draft.regionalName.trim() }),
      });
      const result = await response.json() as { message?: string; data?: FirebaseCategory };
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to add the category.');
      const added = result.data;
      setCategories(current => [...current, toCategory(added, current.length)]
        .sort((left, right) => (Number(left.code) || 0) - (Number(right.code) || 0)));
      setSearchQuery('');
      setStatusFilter('All');
      setAddOpen(false);
      setNoticeIsError(false);
      setNotice('Category added successfully.');
    } catch (requestError) {
      setAddError((requestError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (editTarget) return <EditCategoryForm key={editTarget.id} category={editTarget} outletId={outlet.id} token={token}
    onSessionExpired={onSessionExpired} onCancel={() => setEditTarget(null)} onUpdated={updated => {
      setCategories(current => current.map(category => {
        if (category.id !== updated.id) return category;
        const next = { ...category, name: updated.name, regionalName: updated.regionalName,
          description: updated.regionalName || category.dayType };
        if (updated.imagePath) next.imagePath = updated.imagePath;
        if (updated.imageRemoved) delete next.imagePath;
        return next;
      }));
      setEditTarget(null); setUpdatedPopup(true);
    }} />;

  return (
    <div className="category-page-shell">
      {updatedPopup && <CategoryUpdatedPopup onDismiss={() => setUpdatedPopup(false)} />}
      {deleteAllOpen && <DeleteConfirmation kind="category" name="all categories" busy={deleting} error={deleteAllError}
        title="Delete all categories?" description={`Are you sure you want to delete all categories? This will permanently remove all ${categories.length} categories. Products are kept and stay listed under All products.`}
        confirmLabel="Yes" cancelLabel="No" onCancel={() => { if (!deleteBusy.current) setDeleteAllOpen(false); }} onConfirm={() => void deleteAllCategories()} />}
      {deleteAllDone && <SuccessPopup message="Categories deleted successfully" onDismiss={() => setDeleteAllDone(false)} />}
      {deleteTarget && <DeleteConfirmation kind="category" name={deleteTarget.name} busy={deleting}
        onCancel={() => { if (!deleteBusy.current) setDeleteTarget(null); }} onConfirm={() => void deleteCategory(deleteTarget.id)} />}
      {/* Header Row */}
      <div className="category-header-row">
        <div className="category-title-group">
          <h1>
            <SlidersHorizontal size={22} color="#3567f0" />
            Category Master
          </h1>
          <p>Organize, create, update, and manage your product categories</p>
        </div>
        <div className="category-header-actions category-master-actions">
          <button
            type="button"
            className="btn-primary-add"
            disabled={saving}
            onClick={openAddCategory}
          >
            <Plus size={16} />
            Add New Category
          </button>
          <div className="category-more-actions">
            <button type="button" className="category-menu-toggle" aria-label="Category options" aria-expanded={categoryMenuOpen}
              aria-controls="category-options-menu" onClick={() => setCategoryMenuOpen(value => !value)}><MoreVertical size={17} /></button>
            {categoryMenuOpen && <div id="category-options-menu" className="category-options-menu">
              <button type="button" disabled={loading || deleting || !categories.length} onClick={() => { setCategoryMenuOpen(false); setDeleteAllError(''); setDeleteAllOpen(true); }}><Trash2 size={14} />Delete All</button>
            </div>}
          </div>
        </div>
      </div>

      {/* Toolbar: Search and Filter */}
      <div className="category-toolbar">
        <div className="toolbar-search-box">
          <span className="search-input-icon">
            <Search size={16} />
          </span>
          <input
            type="search"
            className="search-input"
            aria-label="Search categories"
            placeholder="Search category name, code, regional name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="category-stat-card category-total-summary">
          <div className="stat-icon-wrapper blue"><Layers size={20} /></div>
          <div className="stat-info">
            <span className="stat-label">Total Categories</span>
            <span className="stat-value">{stats.total}</span>
          </div>
        </div>

        <div className="toolbar-filters">
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Active' | 'Inactive')}
          >
            <option value="All">All Statuses ({categories.length})</option>
            <option value="Active">Active ({stats.active})</option>
            <option value="Inactive">Inactive ({stats.inactive})</option>
          </select>
        </div>
      </div>

      {/* Categories Table */}
      <div className="category-table-card">
        <table className="category-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Category Name</th>
              <th>Regional Name</th>
              <th>Products</th>
              <th>Created</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>
                  <div className="table-empty-state">
                    <RefreshCw size={30} className="empty-state-icon category-loading-icon" />
                    <h3>Loading categories…</h3>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6}>
                  <div className="table-empty-state">
                    <FolderPlus size={36} className="empty-state-icon" />
                    <h3>{error}</h3>
                    <button
                      type="button"
                      className="btn-primary-add"
                      onClick={() => setReloadKey((value) => value + 1)}
                    >
                      <RefreshCw size={16} />
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : filteredCategories.length > 0 ? (
              filteredCategories.map((cat) => (
                <tr key={cat.id}>
                  <td>
                    <span className="category-code-badge">{cat.code}</span>
                  </td>
                  <td>
                    <div className="category-name-cell">
                      <span
                        className="category-dot"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="category-title-text">{cat.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="category-desc-text" title={cat.regionalName}>
                      {cat.regionalName || '—'}
                    </div>
                  </td>
                  <td>
                    <span className="product-count-chip">
                      <Package size={14} color="#64748b" />
                      {cat.productCount} items
                    </span>
                  </td>
                  <td style={{ color: '#64748b', fontSize: '12px' }}>
                    {cat.createdAt}
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn-icon-action edit"
                        title="Edit category"
                        aria-label="Edit category"
                        disabled={deleting}
                        onClick={() => { setNotice(''); setEditTarget(cat); }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-action delete"
                        title="Delete category"
                        aria-label="Delete category"
                        disabled={deleting}
                        onClick={() => setDeleteTarget({ id: cat.id, name: cat.name })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>
                  <div className="table-empty-state">
                    <FolderPlus size={36} className="empty-state-icon" />
                    <h3>No categories found</h3>
                    <p>
                      {searchQuery || statusFilter !== 'All'
                        ? 'Try adjusting your search query or status filter.'
                        : 'This outlet has no categories in Firebase yet.'}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {addOpen && <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setAddOpen(false); }}>
        <section className="category-modal" role="dialog" aria-modal="true" aria-labelledby="add-category-title">
          <form onSubmit={addCategory}>
            <div className="modal-header"><h3 id="add-category-title">Add New Category</h3><button type="button" className="modal-close-btn" aria-label="Close add category" disabled={saving} onClick={() => setAddOpen(false)}><X size={18} /></button></div>
            <div className="modal-body">
              <div className="form-field"><label htmlFor="new-category-number">Category Number</label><input id="new-category-number" type="text" readOnly disabled={saving} value={loading ? 'Loading…' : error ? 'Unavailable' : String(nextCategoryNumber)} /></div>
              <div className="form-field"><label htmlFor="new-category-name">Category Name</label><input id="new-category-name" required maxLength={200} autoFocus disabled={saving} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></div>
              <div className="form-field"><label htmlFor="new-category-regional">Regional Name</label><input id="new-category-regional" maxLength={200} disabled={saving} value={draft.regionalName} onChange={event => setDraft(current => ({ ...current, regionalName: event.target.value }))} /></div>
              {addError && <p className="category-form-error" role="alert">{addError}</p>}
            </div>
            {loading && <p className="category-form-loading" role="status">Loading the next category number. You can enter the names now.</p>}
            {error && <p className="category-form-error" role="alert">{error} <button type="button" className="btn-secondary" onClick={() => setReloadKey(value => value + 1)}>Retry</button></p>}
            <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setAddOpen(false)}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving || loading || !!error}>{saving ? 'Saving…' : 'Add Category'}</button></div>
          </form>
        </section>
      </div>}
      {notice && <div className="category-toast" role={noticeIsError ? 'alert' : 'status'} style={noticeIsError ? { color: '#fca5a5' } : undefined}>{noticeIsError ? <X size={18} /> : <CheckCircle2 size={18} />}{notice}<button type="button" className="modal-close-btn" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></div>}
    </div>
  );
};
