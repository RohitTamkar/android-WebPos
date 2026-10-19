import { downloadReportExcel, salesTaxRows, salesTaxSummary, type SalesTaxBreakdown } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  Download, FileText, Filter, Package, PackageSearch, Printer,
  ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './CategoryWiseReportPage.css';
import './ProductWiseReportPage.css';

interface ProductRow {
  taxRate?: string | number;
  taxAmount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
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
  summary: { totalProducts: number; totalBills: number; totalQuantity: number; totalAmount: number; totalTax?: number };
}

interface ProductFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  search: string;
}

interface ProductWiseReportPageProps {
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

// Numeric codes sort numerically; missing codes go last.
function compareCodes(left: string, right: string): number {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return left.localeCompare(right, undefined, { numeric: true });
}

export const ProductWiseReportPage = ({ outlet, token, onSessionExpired, reportName = 'Product Wise' }: ProductWiseReportPageProps) => {
  const initialFilters = useMemo<ProductFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<ProductReportResponse | null>(null);
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
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: ProductReportResponse };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load products.');
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

  const sortedProducts = useMemo(() => {
    const rows = [...(report?.products ?? [])];
    return rows.sort((left, right) => compareCodes(left.code, right.code));
  }, [report]);

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
    const taxSummary = salesTaxSummary(sortedProducts);
    const totalTax = report.summary.totalTax ?? Number(taxSummary['TOTAL TAX']);
    const rows: (string | number | Date)[][] = [
      ['Search Code', 'Product Name', 'Category', 'Tax Rate', 'Qty Sold', 'Sale', 'Tax Amount', 'Discount'],
      ...sortedProducts.flatMap(product => salesTaxRows(product).map(group => [
        product.code, product.name, product.category, group.rate === null ? 0 : `${group.rate}%`,
        group.quantity, group.amount, group.taxAmount, 0,
      ])),
      ['', 'Total', '', '', report.summary.totalQuantity, report.summary.totalAmount, totalTax, 0],
    ];
    await downloadReportExcel({
      name: reportName, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
      summary: { ...taxSummary, 'TOTAL SALE': report.summary.totalAmount, 'TOTAL TAX': totalTax }, rows,
    });
  };

  return (
    <section className="bill-report-page category-report-page product-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><h1>Product Wise Report</h1><p>{outlet.name} · Billing totals for each product, with product codes.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!report?.products.length}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters category-product-search-filters">
        <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={value => setFilters(current => ({ ...current, startDate: value }))} /></label>
        <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={value => setFilters(current => ({ ...current, endDate: value }))} /></label>
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
            <div className="bill-table-scroll"><table><thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Bills</th><th>Quantity</th><th className="amount">Avg Rate</th><th>Share</th><th className="amount">Amount</th></tr></thead><tbody>{sortedProducts.map(product => <tr key={product.productId}><td className="product-code-cell"><span className="product-code">{product.code || '—'}</span></td><td><strong>{product.name}</strong></td><td>{product.category}</td><td>{product.billCount}</td><td>{quantity(product.quantity)}</td><td className="amount">{money(product.averageRate)}</td><td><div className="category-share"><span><i style={{ width: `${Math.min(100, product.share)}%` }} /></span><small>{product.share.toFixed(1)}%</small></div></td><td className="amount"><strong>{money(product.amount)}</strong></td></tr>)}</tbody><tfoot><tr><td /><td><strong>Total</strong></td><td /><td>{report.summary.totalBills}</td><td>{quantity(report.summary.totalQuantity)}</td><td /><td>100%</td><td className="amount"><strong>{money(report.summary.totalAmount)}</strong></td></tr></tfoot></table></div>
          </>
        )}
      </div>
    </section>
  );
};
