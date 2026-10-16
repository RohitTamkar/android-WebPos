import { downloadReportExcel, salesTaxRows, salesTaxSummary, type SalesTaxBreakdown } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  Download, FileText, Filter, Layers, Package, Printer,
  ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './CategoryWiseReportPage.css';

interface ProductTotals {
  taxRate?: string | number;
  taxAmount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
  productId: string;
  name: string;
  quantity: number;
  amount: number;
}

interface CategoryRow {
  categoryNo?: number | null;
  taxRate?: string | number;
  taxAmount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
  categoryId: string;
  name: string;
  billCount: number;
  productCount: number;
  quantity: number;
  amount: number;
  share: number;
  products: ProductTotals[];
}

interface CategoryReportResponse {
  categories: CategoryRow[];
  summary: { totalCategories: number; totalBills: number; totalQuantity: number; totalAmount: number; totalTax?: number };
}

interface CategoryFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  search: string;
}

interface CategoryWiseReportPageProps {
  outlet: OutletSummary;
  reportName?: string;
  token: string;
  onSessionExpired: () => void;
}

function todayId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function money(value = 0): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
}

function quantity(value = 0): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

export const CategoryWiseReportPage = ({ outlet, token, onSessionExpired, reportName = 'Category Wise' }: CategoryWiseReportPageProps) => {
  const initialFilters = useMemo<CategoryFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<CategoryReportResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startDate: appliedFilters.startDate, endDate: appliedFilters.endDate });
    if (appliedFilters.shiftId) params.set('shiftId', appliedFilters.shiftId);
    if (appliedFilters.search) params.set('search', appliedFilters.search);

    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/categories?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: CategoryReportResponse };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load categories.');
        setReport(result.data);
      })
      .catch(requestError => {
        if (!controller.signal.aborted) setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, appliedFilters, reloadKey]);

  const applyFilters = () => {
    const dateError = reportDateError(filters.startDate, filters.endDate);
    if (dateError) {
      setError(dateError);
      return;
    }
    setAppliedFilters({ ...filters, search: filters.search.trim() });
  };

  const resetFilters = () => {
    const reset = { ...initialFilters, startDate: todayId(), endDate: todayId() };
    setFilters(reset);
    setAppliedFilters(reset);
  };

  const exportExcel = async () => {
    if (!report) return;
    const taxSummary = salesTaxSummary(report.categories);
    const totalTax = report.summary.totalTax ?? Number(taxSummary['TOTAL TAX']);
    const rows: (string | number | Date)[][] = [
      ['Category No', 'Category Name', 'Tax Rate', 'Total Products', 'Items Sold', 'Sale', 'Tax Amount', 'Discount'],
      ...report.categories.flatMap(category => salesTaxRows(category).flatMap(group => [
        [category.categoryNo ?? 0, category.name, group.rate === null ? 0 : `${group.rate}%`,
          group.productCount ?? category.productCount, group.quantity, group.amount, group.taxAmount, 0],
        ...category.products.flatMap(product => salesTaxRows(product)
          .filter(productGroup => !category.taxBreakdown?.length || productGroup.rate === group.rate)
          .map(productGroup => ['', product.name, productGroup.rate === null ? 0 : `${productGroup.rate}%`, '',
            productGroup.quantity, productGroup.amount, productGroup.taxAmount, 0])),
      ])),
      ['Total', '', '', '', report.summary.totalQuantity, report.summary.totalAmount, totalTax, 0],
    ];
    await downloadReportExcel({
      name: reportName, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
      summary: { ...taxSummary, 'TOTAL SALE': report.summary.totalAmount, 'TOTAL TAX': totalTax }, rows,
    });
  };

  return (
    <section className="bill-report-page category-report-page">
      <div className="bill-report-heading">
        <div><span>REPORTS</span><h1>Category Wise Report</h1><p>{outlet.name} · Billing totals grouped by product category.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!report?.categories.length}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters category-product-search-filters">
        <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={event => setFilters(current => ({ ...current, startDate: event.target.value }))} /></label>
        <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={event => setFilters(current => ({ ...current, endDate: event.target.value }))} /></label>
        <label className="bill-search-filter"><span>Category search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Category name" /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><Layers /></span><div><small>Categories</small><strong>{report?.summary.totalCategories ?? 0}</strong></div></article>
        <article><span><ReceiptText /></span><div><small>Bills</small><strong>{report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><Package /></span><div><small>Quantity Sold</small><strong>{quantity(report?.summary.totalQuantity)}</strong></div></article>
        <article><span><FileText /></span><div><small>Total Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading categories…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.categories.length === 0 && <div className="bill-report-state"><Layers /><strong>No category sales found for these filters.</strong><p>Choose another date or clear some filters.</p></div>}
        {!loading && !error && report && report.categories.length > 0 && (
          <div className="bill-table-scroll"><table><thead><tr><th>Category</th><th>Bills</th><th>Products</th><th>Quantity</th><th>Share</th><th className="amount">Amount</th></tr></thead><tbody>{report.categories.map(category => <tr key={category.categoryId} onClick={() => setSelectedCategory(category)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setSelectedCategory(category); }}><td><strong>{category.name}</strong><small>{category.productCount} products sold</small></td><td>{category.billCount}</td><td>{category.productCount}</td><td>{quantity(category.quantity)}</td><td><div className="category-share"><span><i style={{ width: `${Math.min(100, category.share)}%` }} /></span><small>{category.share.toFixed(1)}%</small></div></td><td className="amount"><strong>{money(category.amount)}</strong></td></tr>)}</tbody><tfoot><tr><td><strong>Total</strong></td><td>{report.summary.totalBills}</td><td /><td>{quantity(report.summary.totalQuantity)}</td><td>100%</td><td className="amount"><strong>{money(report.summary.totalAmount)}</strong></td></tr></tfoot></table></div>
        )}
      </div>

      {selectedCategory && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedCategory(null); }}><article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`Category ${selectedCategory.name}`}><header><div><span>CATEGORY DETAILS</span><h2>{selectedCategory.name}</h2><p>{appliedFilters.startDate === appliedFilters.endDate ? appliedFilters.startDate : `${appliedFilters.startDate} → ${appliedFilters.endDate}`}</p></div><button type="button" onClick={() => setSelectedCategory(null)} aria-label="Close category details"><X /></button></header><div className="bill-detail-body"><div className="bill-detail-meta"><div><span>Bills</span><strong>{selectedCategory.billCount}</strong></div><div><span>Products sold</span><strong>{selectedCategory.productCount}</strong></div><div><span>Quantity</span><strong>{quantity(selectedCategory.quantity)}</strong></div><div><span>Share of sales</span><strong>{selectedCategory.share.toFixed(2)}%</strong></div></div><h3>Products</h3><div className="bill-items-table"><table><thead><tr><th>Product</th><th>Qty</th><th>Amount</th></tr></thead><tbody>{selectedCategory.products.map(product => <tr key={product.productId}><td>{product.name}</td><td>{quantity(product.quantity)}</td><td>{money(product.amount)}</td></tr>)}</tbody></table></div><div className="bill-total-detail"><div className="grand-total"><span>Category Total</span><strong>{money(selectedCategory.amount)}</strong></div></div></div><footer><button type="button" onClick={() => window.print()}><Printer /> Print / Save PDF</button></footer></article></div>}
    </section>
  );
};
