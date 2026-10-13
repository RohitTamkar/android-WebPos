import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Download, FileText, Filter, Package, PackageSearch, Printer,
  ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './CategoryWiseReportPage.css';
import './ProductWiseReportPage.css';

interface ProductRow {
  productId: string;
  code: string;
  name: string;
  category: string;
  billCount: number;
  quantity: number;
  averageRate: number;
  amount: number;
  share: number;
}

interface ProductReportResponse {
  products: ProductRow[];
  summary: { totalProducts: number; totalBills: number; totalQuantity: number; totalAmount: number };
}

interface ProductFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  search: string;
}

type SortKey = 'amount' | 'code' | 'quantity';

interface ProductWiseReportPageProps {
  outlet: OutletSummary;
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

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

// Numeric codes sort numerically; missing codes go last.
function compareCodes(left: string, right: string): number {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return left.localeCompare(right, undefined, { numeric: true });
}

export const ProductWiseReportPage = ({ outlet, token, onSessionExpired }: ProductWiseReportPageProps) => {
  const initialFilters = useMemo<ProductFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<ProductReportResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startDate: appliedFilters.startDate, endDate: appliedFilters.endDate });
    if (appliedFilters.shiftId) params.set('shiftId', appliedFilters.shiftId);
    if (appliedFilters.search) params.set('search', appliedFilters.search);

    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: ProductReportResponse };
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load products.');
        setReport(result.data);
      })
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, appliedFilters, reloadKey]);

  const sortedProducts = useMemo(() => {
    const rows = [...(report?.products ?? [])];
    if (sortKey === 'code') return rows.sort((left, right) => compareCodes(left.code, right.code));
    if (sortKey === 'quantity') return rows.sort((left, right) => right.quantity - left.quantity);
    return rows.sort((left, right) => right.amount - left.amount);
  }, [report, sortKey]);

  const applyFilters = () => {
    if (filters.startDate > filters.endDate) {
      setError('Start date must be before the end date.');
      return;
    }
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
  };

  const exportExcel = () => {
    if (!report) return;
    const rows: (string | number)[][] = [
      ['Product Code', 'Product', 'Category', 'Bills', 'Quantity', 'Avg Rate', 'Amount', 'Share %'],
      ...sortedProducts.map(product => [
        product.code, product.name, product.category, product.billCount, product.quantity,
        product.averageRate.toFixed(2), product.amount, product.share.toFixed(2),
      ]),
      ['', 'Total', '', report.summary.totalBills, report.summary.totalQuantity, '', report.summary.totalAmount, '100.00'],
    ];
    const csv = `﻿${rows.map(row => row.map(value => csvCell(value)).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `product-wise-${outlet.name}-${appliedFilters.startDate}-${appliedFilters.endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bill-report-page category-report-page product-report-page">
      <div className="bill-report-heading">
        <div><span>REPORTS</span><h1>Product Wise Report</h1><p>{outlet.name} · Billing totals for each product, with product codes.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!report?.products.length}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>From date</span><div><CalendarDays /><input type="date" value={filters.startDate} onChange={event => setFilters(current => ({ ...current, startDate: event.target.value }))} /></div></label>
        <label><span>To date</span><div><CalendarDays /><input type="date" value={filters.endDate} onChange={event => setFilters(current => ({ ...current, endDate: event.target.value }))} /></div></label>
        <label><span>Shift</span><input value={filters.shiftId} onChange={event => setFilters(current => ({ ...current, shiftId: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="All shifts" /></label>
        <label className="bill-search-filter"><span>Product search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Product code, name or category" /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><PackageSearch /></span><div><small>Products Sold</small><strong>{report?.summary.totalProducts ?? 0}</strong></div></article>
        <article><span><ReceiptText /></span><div><small>Bills</small><strong>{report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><Package /></span><div><small>Quantity Sold</small><strong>{quantity(report?.summary.totalQuantity)}</strong></div></article>
        <article><span><FileText /></span><div><small>Total Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading products…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.products.length === 0 && <div className="bill-report-state"><PackageSearch /><strong>No product sales found for these filters.</strong><p>Choose another date or clear some filters.</p></div>}
        {!loading && !error && report && report.products.length > 0 && (
          <>
            <div className="product-sort-bar"><span>Sort by</span>{(['amount', 'code', 'quantity'] as SortKey[]).map(key => <button type="button" key={key} className={sortKey === key ? 'active' : ''} onClick={() => setSortKey(key)}>{key === 'amount' ? 'Amount' : key === 'code' ? 'Product code' : 'Quantity'}</button>)}</div>
            <div className="bill-table-scroll"><table><thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Bills</th><th>Quantity</th><th className="amount">Avg Rate</th><th>Share</th><th className="amount">Amount</th></tr></thead><tbody>{sortedProducts.map(product => <tr key={product.productId}><td className="product-code-cell"><span className="product-code">{product.code || '—'}</span></td><td><strong>{product.name}</strong></td><td>{product.category}</td><td>{product.billCount}</td><td>{quantity(product.quantity)}</td><td className="amount">{money(product.averageRate)}</td><td><div className="category-share"><span><i style={{ width: `${Math.min(100, product.share)}%` }} /></span><small>{product.share.toFixed(1)}%</small></div></td><td className="amount"><strong>{money(product.amount)}</strong></td></tr>)}</tbody><tfoot><tr><td /><td><strong>Total</strong></td><td /><td>{report.summary.totalBills}</td><td>{quantity(report.summary.totalQuantity)}</td><td /><td>100%</td><td className="amount"><strong>{money(report.summary.totalAmount)}</strong></td></tr></tfoot></table></div>
          </>
        )}
      </div>
    </section>
  );
};
