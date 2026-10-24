import { downloadReportExcel } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Boxes, ChevronLeft, ChevronRight, Download, FileText, Filter, Package, Printer, RefreshCw, Search, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './StockInOutReportPage.css';

interface MovementItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  cost: number;
  total: number;
  remark: string;
}

interface StockMovement {
  documentId: string;
  transactionNo: string;
  dayId: string;
  createdDate: number;
  type: string;
  direction: 'in' | 'out';
  supplier: string;
  remark: string;
  source: string;
  state: string;
  quantity: number;
  total: number;
  roundOff: number;
  finalTotal: number;
  items: MovementItem[];
}

interface MovementReport {
  movements: StockMovement[];
  summary: { totalTransactions: number; stockInQuantity: number; stockOutQuantity: number; netQuantity: number; totalAmount: number };
}

interface StockInOutReportPageProps {
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

function dateTime(value: number): string {
  return value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
}

const PAGE_SIZE = 50;

export const StockInOutReportPage = ({ outlet, token, onSessionExpired, reportName = 'Stock In-Out Report' }: StockInOutReportPageProps) => {
  const initialFilters = useMemo(() => ({ startDate: todayId(), endDate: todayId(), direction: 'in' as 'in' | 'out', search: '' }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<MovementReport | null>(null);
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters, setPage);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(appliedFilters);
    // Synchronize report state with the requested filters and outlet.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true);
    setError('');
    setReport(null);
    setSelectedMovement(null);
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/stock-movements?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { message?: string; data?: MovementReport };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load stock movements.');
        setReport(result.data);
        setPage(1);
      })
      .catch(requestError => { if (!controller.signal.aborted) setError((requestError as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [outlet.id, token, appliedFilters, reloadKey, onSessionExpired]);

  useEffect(() => {
    if (!selectedMovement) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedMovement(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedMovement]);

  const applyFilters = () => {
    const dateError = reportDateError(filters.startDate, filters.endDate);
    if (dateError) {
      setError(dateError);
      return;
    }
    setPage(1);
    setAppliedFilters({ ...filters, search: filters.search.trim() });
  };

  const resetFilters = () => {
    const reset = { startDate: todayId(), endDate: todayId(), direction: appliedFilters.direction, search: '' };
    setFilters(reset);
    setAppliedFilters(reset);
    setPage(1);
  };

  // Stock-In and Stock-Out are separate views; switching loads only that direction.
  const showDirection = (direction: 'in' | 'out') => {
    if (direction === appliedFilters.direction) return;
    setFilters(current => ({ ...current, direction }));
    setAppliedFilters(current => ({ ...current, direction }));
    setPage(1);
  };
  const isIn = appliedFilters.direction === 'in';
  const directionLabel = isIn ? 'Stock-In' : 'Stock-Out';
  const totalPages = Math.max(1, Math.ceil((report?.movements.length ?? 0) / PAGE_SIZE));
  const rows = report?.movements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];
  const hasData = !!report?.movements.length;
  const exportExcel = async () => {
    if (!report) return;
    const csvRows: (string | number | Date)[][] = [
      ['Transaction No', 'Day ID', 'Date / Time', 'Type', 'Direction', 'Supplier', 'Product ID', 'Product', 'Quantity', 'Rate', 'Cost', 'Product Total', 'Transaction Total', 'Remark'],
      ...report.movements.flatMap(entry => (entry.items.length ? entry.items : [null]).map(item => [
        entry.transactionNo, entry.dayId, (entry.createdDate ? new Date(entry.createdDate) : '—'), entry.type, entry.direction === 'in' ? 'Stock In' : 'Stock Out', entry.supplier,
        item?.productId ?? '', item?.name ?? 'No product details available', item?.quantity ?? '',
        item?.price ?? '', item?.cost ?? '', item?.total ?? '', entry.finalTotal, entry.remark,
      ])),
      [`Total ${directionLabel} / total amount`, '', '', '', '', '', '', '', isIn ? report.summary.stockInQuantity : report.summary.stockOutQuantity, '', '', '', report.summary.totalAmount, ''],
    ];
    await downloadReportExcel({
      name: `${reportName} - ${directionLabel}`, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
      summary: {}, rows: csvRows,
    });
  };

  return <section className="bill-report-page stock-in-out-report-page">
    <div className="bill-report-heading">
      <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><h1>Stock In-Out Report</h1><p>{outlet.name} · {isIn ? 'Stock received' : 'Stock issued'} and product details.</p><strong className="stock-print-direction">{directionLabel}</strong></div>
      <div className="bill-report-actions">
        <button type="button" onClick={() => setReloadKey(value => value + 1)} disabled={loading}><RefreshCw /> Refresh</button>
        <button type="button" onClick={exportExcel} disabled={!hasData || loading || !!error}><Download /> Export Excel</button>
        <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
      </div>
    </div>
    <div className="stock-direction-tabs" role="tablist" aria-label="Stock direction">
      {(['in', 'out'] as const).map(direction => <button key={direction} type="button" role="tab" aria-selected={appliedFilters.direction === direction}
        className={`stock-direction-tab ${direction}`} disabled={loading && appliedFilters.direction !== direction} onClick={() => showDirection(direction)}>
        {direction === 'in' ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}<span>{direction === 'in' ? 'STOCK-IN' : 'STOCK-OUT'}</span></button>)}
    </div>
    <div className="bill-report-filters">
      <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={value => setFilters(current => ({ ...current, startDate: value }))} /></label>
      <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={value => setFilters(current => ({ ...current, endDate: value }))} /></label>
      <label className="bill-search-filter"><span>Transaction / product search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Transaction no., supplier or product" /></div></label>
      <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
    </div>
    <div className="bill-summary-grid stock-summary-grid">
      <article><span><FileText /></span><div><small>{directionLabel} Transactions</small><strong>{report?.summary.totalTransactions ?? 0}</strong></div></article>
      <article><span>{isIn ? <Package /> : <Boxes />}</span><div><small>{isIn ? 'Stock In Quantity' : 'Stock Out Quantity'}</small><strong>{quantity(isIn ? report?.summary.stockInQuantity : report?.summary.stockOutQuantity)}</strong></div></article>
      <article><span><FileText /></span><div><small>Total Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
    </div>
    <div className="bill-table-card">
      {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading stock movements…</strong></div>}
      {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
      {!loading && !error && !hasData && <div className="bill-report-state"><Package /><strong>No {directionLabel.toLowerCase()} transactions found for these filters.</strong><p>Choose another date range or clear the search.</p></div>}
      {!loading && !error && hasData && report && <>
        <div className="bill-table-scroll"><table>
          <colgroup><col className="stock-col-products" /><col className="stock-col-type" /><col className="stock-col-quantity" /><col className="stock-col-price" /><col className="stock-col-supplier" /><col className="stock-col-date" /></colgroup>
          <thead><tr><th>Product Name</th><th>Type</th><th className="amount">Quantity</th><th className="amount">Price</th><th>Supplier</th><th>Date / Time</th></tr></thead>
          <tbody>{rows.map(entry => <tr key={entry.documentId} tabIndex={0} aria-label={`View stock transaction ${entry.transactionNo}`} onClick={() => setSelectedMovement(entry)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedMovement(entry); } }}>
            <td><strong>{entry.items.map(item => item.name).join(', ') || '—'}</strong></td><td>{entry.type}</td><td className="amount">{quantity(entry.quantity)}</td><td className="amount"><strong>{money(entry.finalTotal)}</strong></td><td>{entry.supplier || '—'}</td><td>{dateTime(entry.createdDate)}</td>
          </tr>)}</tbody>
          <tfoot><tr><td><strong>Total {directionLabel}</strong></td><td>{report.summary.totalTransactions} transactions</td><td className="amount">{quantity(isIn ? report.summary.stockInQuantity : report.summary.stockOutQuantity)}</td><td className="amount"><strong>{money(report.summary.totalAmount)}</strong></td><td colSpan={2} /></tr></tfoot>
        </table></div>
        <div className="bill-pagination"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, report.movements.length)} of {report.movements.length}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><strong>Page {page} of {totalPages}</strong><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>
      </>}
    </div>
    {selectedMovement && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedMovement(null); }}><article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`Stock transaction ${selectedMovement.transactionNo}`}>
      <header><div><span>STOCK IN-OUT DETAILS</span><h2>{selectedMovement.transactionNo}</h2><p>{dateTime(selectedMovement.createdDate)}</p></div><button type="button" aria-label="Close transaction details" autoFocus onClick={() => setSelectedMovement(null)}><X /></button></header>
      <div className="bill-detail-body">
        <div className="bill-detail-meta">{[
          ['Day ID', selectedMovement.dayId], ['Transaction ID', selectedMovement.documentId], ['Type', selectedMovement.type], ['Direction', selectedMovement.direction === 'in' ? 'Stock In' : 'Stock Out'],
          ['Supplier', selectedMovement.supplier], ['Source', selectedMovement.source], ['State', selectedMovement.state], ['Remark', selectedMovement.remark],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div>
        <h3>Products</h3><div className="bill-items-table"><table><thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>Cost</th><th>Total</th></tr></thead><tbody>{selectedMovement.items.length ? selectedMovement.items.map((item, index) => <tr key={index}><td><strong>{item.name}</strong><small>{item.productId}{item.remark ? ` · ${item.remark}` : ''}</small></td><td>{quantity(item.quantity)}</td><td>{money(item.price)}</td><td>{money(item.cost)}</td><td>{money(item.total)}</td></tr>) : <tr><td colSpan={5}>No product details available</td></tr>}</tbody></table></div>
        <div className="bill-total-detail"><div><span>Quantity</span><strong>{quantity(selectedMovement.quantity)}</strong></div><div><span>Sub Total</span><strong>{money(selectedMovement.total)}</strong></div><div><span>Round Off</span><strong>{money(selectedMovement.roundOff)}</strong></div><div className="grand-total"><span>Transaction Total</span><strong>{money(selectedMovement.finalTotal)}</strong></div></div>
      </div>
      <footer><button type="button" onClick={() => setSelectedMovement(null)}>Close</button></footer>
    </article></div>}
  </section>;
};
