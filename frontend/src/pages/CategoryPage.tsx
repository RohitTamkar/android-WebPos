import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './CategoryPage.css';

export interface Category {
  id: string;
  code: string;
  name: string;
  description: string;
  status: 'Active' | 'Inactive';
  productCount: number;
  color: string;
  createdAt: string;
}

// Shape returned by GET /api/outlets/:outletId/categories (Firestore OUTLET/{id}/CATEGORY).
interface FirebaseCategory {
  id: string;
  categoryNo: number;
  name: string;
  regionalName: string;
  dayType: string;
  active: boolean;
  productCount: number;
  createdAt: string;
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

const READ_ONLY_HINT = 'Categories are read-only here. Manage them from the POS app.';

function toCategory(category: FirebaseCategory, index: number): Category {
  return {
    id: category.id,
    code: category.categoryNo ? `CAT-${String(category.categoryNo).padStart(3, '0')}` : '—',
    name: category.name,
    description: category.regionalName || category.dayType,
    status: category.active ? 'Active' : 'Inactive',
    productCount: category.productCount,
    color: PRESET_COLORS[index % PRESET_COLORS.length] ?? '#3567f0',
    createdAt: category.createdAt ? category.createdAt.slice(0, 10) : '—',
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

  // Categories are only read from Firebase; this page never writes them back.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/categories`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: FirebaseCategory[] };
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load categories.');
        setCategories(result.data.map(toCategory));
      })
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, reloadKey]);

  // Filtered categories
  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      const matchesSearch =
        cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cat.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cat.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'All' || cat.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [categories, searchQuery, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = categories.length;
    const active = categories.filter((c) => c.status === 'Active').length;
    const totalItems = categories.reduce((sum, c) => sum + c.productCount, 0);
    return { total, active, totalItems };
  }, [categories]);

  return (
    <div className="category-page-shell">
      {/* Header Row */}
      <div className="category-header-row">
        <div className="category-title-group">
          <h1>
            <SlidersHorizontal size={22} color="#3567f0" />
            Category Master
          </h1>
          <p>Organize, create, update, and manage your product categories</p>
        </div>
        <div className="category-header-actions">
          <button
            type="button"
            className="btn-primary-add"
            disabled
            title={READ_ONLY_HINT}
          >
            <Plus size={16} />
            Add New Category
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="category-stats-grid">
        <div className="category-stat-card">
          <div className="stat-icon-wrapper blue">
            <Layers size={22} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Total Categories</span>
            <span className="stat-value">{stats.total}</span>
          </div>
        </div>

        <div className="category-stat-card">
          <div className="stat-icon-wrapper green">
            <CheckCircle2 size={22} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Active Categories</span>
            <span className="stat-value">{stats.active}</span>
          </div>
        </div>

        <div className="category-stat-card">
          <div className="stat-icon-wrapper purple">
            <Package size={22} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Total Assigned Items</span>
            <span className="stat-value">{stats.totalItems}</span>
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
            type="text"
            className="search-input"
            placeholder="Search category name, code, description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="toolbar-filters">
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Active' | 'Inactive')}
          >
            <option value="All">All Statuses ({categories.length})</option>
            <option value="Active">Active ({stats.active})</option>
            <option value="Inactive">Inactive ({stats.total - stats.active})</option>
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
              <th>Description</th>
              <th>Products</th>
              <th>Status</th>
              <th>Created</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>
                  <div className="table-empty-state">
                    <RefreshCw size={30} className="empty-state-icon category-loading-icon" />
                    <h3>Loading categories…</h3>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7}>
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
                    <div className="category-desc-text" title={cat.description}>
                      {cat.description || '—'}
                    </div>
                  </td>
                  <td>
                    <span className="product-count-chip">
                      <Package size={14} color="#64748b" />
                      {cat.productCount} items
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-badge ${
                        cat.status === 'Active' ? 'active' : 'inactive'
                      }`}
                    >
                      {cat.status}
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
                        title={READ_ONLY_HINT}
                        disabled
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-action delete"
                        title={READ_ONLY_HINT}
                        disabled
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>
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
    </div>
  );
};
