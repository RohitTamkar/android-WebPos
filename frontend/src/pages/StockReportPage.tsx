import { downloadReportExcel } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Boxes, ChevronLeft, ChevronRight, Download, Filter, PackageSearch,
  PackageX, Printer, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './ProductWiseReportPage.css';
import './StockReportPage.css';

type StockStatus = 'In stock' | 'Low stock' | 'Out of stock' | 'Not tracked';

interface StockRow {
  productId: string;
  code: string;
  name: string;
  categoryId: string;
  category: string;
  tracked: boolean;
  currentStock: number;
  reorderLevel: number;
  price: number;
  costPrice: number;
  stockValue: number;
  status: StockStatus;
}

interface StockReportResponse {
  products: StockRow[];
  categories: Array<{ id: string; name: string }>;
}

interface StockFilters {
  categoryId: string;
  status: string;
  search: string;
}

type SortKey = 'code' | 'stock' | 'name';

const PAGE_SIZE = 50;

const STATUS_CLASS: Record<StockStatus, string> = {
  'In stock': 'in-stock',
  'Low stock': 'low-stock',
  'Out of stock': 'out-of-stock',
  'Not tracked': 'not-tracked',
};

interface StockReportPageProps {
  outlet: OutletSummary;
  reportName?: string;
  token: string;
  onSessionExpired: () => void;
}

function money(value = 0): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
}

function quantity(value = 0): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

function todayId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const StockReportPage = ({ outlet, token, onSessionExpired, reportName = 'Stock Report' }: StockReportPageProps) => {
  const initialFilters = useMemo<StockFilters>(() => ({ categoryId: '', status: '', search: '' }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<StockReportResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters, setPage);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/stock`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: StockReportResponse };
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load stock.');
        setReport(result.data);
      })
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, reloadKey]);

  // Filtering is done in the browser because the full product list is already loaded.
  const rows = useMemo(() => {
    const search = appliedFilters.search.trim().toLowerCase();
    const filtered = (report?.products ?? []).filter(product =>
      (!appliedFilters.categoryId || product.categoryId === appliedFilters.categoryId)
      && (!appliedFilters.status || product.status === appliedFilters.status)
      && (!search
        || product.name.toLowerCase().includes(search)
        || product.code.toLowerCase().includes(search)
        || product.category.toLowerCase().includes(search)));
    if (sortKey === 'stock') return filtered.sort((left, right) => left.currentStock - right.currentStock);
    if (sortKey === 'name') return filtered.sort((left, right) => left.name.localeCompare(right.name));
    return filtered;
  }, [report, appliedFilters, sortKey]);

  const summary = useMemo(() => rows.reduce((totals, product) => {
    if (product.tracked) {
      totals.tracked += 1;
      totals.totalStock += product.currentStock;
      totals.stockValue += product.stockValue;
    }
    if (product.status === 'Low stock') totals.low += 1;
    if (product.status === 'Out of stock') totals.out += 1;
    return totals;
  }, { tracked: 0, totalStock: 0, stockValue: 0, low: 0, out: 0 }), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters({ ...filters, search: filters.search.trim() });
  };

  const resetFilters = () => {
    setFilters(initialFilters);
    setPage(1);
    setAppliedFilters(initialFilters);
  };

  const exportExcel = async () => {
    const csvRows: (string | number | Date)[][] = [
      ['Product Code', 'Product', 'Category', 'Stock Tracked', 'Current Stock', 'Reorder Level', 'Status', 'Price', 'Stock Value'],
      ...rows.map(product => [
        product.code, product.name, product.category, product.tracked ? 'Yes' : 'No', product.currentStock,
        product.reorderLevel, product.status, product.price, product.stockValue,
      ]),
      ['', 'Total', '', summary.tracked, summary.totalStock, '', '', '', summary.stockValue],
    ];
    await downloadReportExcel({
      name: reportName, outlet, startDate: todayId(), endDate: todayId(),
      summary: {}, rows: csvRows,
    });
  };

  return (
    <section className="bill-report-page product-report-page stock-report-page">
      <div className="bill-report-heading">
        <div><span>REPORTS</span><h1>Stock Report</h1><p>{outlet.name} · Current stock count for stockable products.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={() => setReloadKey(value => value + 1)} disabled={loading}><RefreshCw /> Refresh</button>
          <button type="button" onClick={exportExcel} disabled={!rows.length}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>Category</span><select value={filters.categoryId} onChange={event => setFilters(current => ({ ...current, categoryId: event.target.value }))}><option value="">All categories</option>{report?.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span>Stock status</span><select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}><option value="">All statuses</option><option value="In stock">In stock</option><option value="Low stock">Low stock</option><option value="Out of stock">Out of stock</option></select></label>
        <label className="bill-search-filter"><span>Product search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Product code, name or category" /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><PackageSearch /></span><div><small>Stockable Products</small><strong>{rows.length}</strong></div></article>
        <article><span><Boxes /></span><div><small>Total Stock Qty</small><strong>{quantity(summary.totalStock)}</strong></div></article>
        <article><span><AlertTriangle /></span><div><small>Low Stock</small><strong>{summary.low}</strong></div></article>
        <article><span><PackageX /></span><div><small>Out of Stock</small><strong>{summary.out}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading stock…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report && rows.length === 0 && <div className="bill-report-state"><PackageSearch /><strong>No products found.</strong><p>{report.products.length ? 'Clear some filters to see more products.' : 'This outlet has no stockable products.'}</p></div>}
        {!loading && !error && report && rows.length > 0 && (
          <>
            <div className="product-sort-bar"><span>Sort by</span>{(['code', 'stock', 'name'] as SortKey[]).map(key => <button type="button" key={key} className={sortKey === key ? 'active' : ''} onClick={() => { setSortKey(key); setPage(1); }}>{key === 'code' ? 'Product code' : key === 'stock' ? 'Lowest stock' : 'Name'}</button>)}</div>
            <div className="bill-table-scroll"><table><thead><tr><th>Code</th><th>Product</th><th>Category</th><th className="amount">Stock Count</th><th className="amount">Reorder Level</th><th>Status</th><th className="amount">Price</th><th className="amount">Stock Value</th></tr></thead><tbody>{pagedRows.map(product => <tr key={product.productId}><td className="product-code-cell"><span className="product-code">{product.code || '—'}</span></td><td><strong>{product.name}</strong></td><td>{product.category}</td><td className="amount"><strong className={product.tracked ? (product.currentStock <= 0 ? 'stock-count negative' : 'stock-count') : 'stock-count muted'}>{quantity(product.currentStock)}</strong></td><td className="amount">{product.reorderLevel ? quantity(product.reorderLevel) : '—'}</td><td><span className={`stock-status ${STATUS_CLASS[product.status]}`}>{product.status}</span></td><td className="amount">{money(product.price)}</td><td className="amount">{product.tracked ? money(product.stockValue) : '—'}</td></tr>)}</tbody><tfoot><tr><td /><td><strong>Total</strong></td><td>{rows.length} products</td><td className="amount">{quantity(summary.totalStock)}</td><td /><td /><td /><td className="amount"><strong>{money(summary.stockValue)}</strong></td></tr></tfoot></table></div>
            <div className="bill-pagination"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><strong>Page {page} of {totalPages}</strong><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>
          </>
        )}
      </div>
    </section>
  );
};
