import { downloadReportExcel } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import { Boxes, ChevronLeft, ChevronRight, Download, FileText, Filter, Package, Printer, RefreshCw, Search, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './StockTransferReportPage.css';

interface TransferItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  cost: number;
  total: number;
  remark: string;
}

interface StockTransfer {
  documentId: string;
  transferNo: string;
  dayId: string;
  createdDate: number;
  type: string;
  supplier: string;
  remark: string;
  source: string;
  state: string;
  quantity: number;
  total: number;
  roundOff: number;
  finalTotal: number;
  items: TransferItem[];
  references: { field: string; value: string }[];
}

interface TransferReport {
  transfers: StockTransfer[];
  summary: { totalTransfers: number; totalProducts: number; totalQuantity: number; totalAmount: number };
}

interface StockTransferReportPageProps {
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

export const StockTransferReportPage = ({ outlet, token, onSessionExpired, reportName = 'Stock Transfer Report' }: StockTransferReportPageProps) => {
  const initialFilters = useMemo(() => ({ startDate: todayId(), endDate: todayId(), search: '' }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<TransferReport | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);
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
    setSelectedTransfer(null);
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/stock-transfers?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { message?: string; data?: TransferReport };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load stock transfers.');
        setReport(result.data);
        setPage(1);
      })
      .catch(requestError => { if (!controller.signal.aborted) setError((requestError as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [outlet.id, token, appliedFilters, reloadKey, onSessionExpired]);

  useEffect(() => {
    if (!selectedTransfer) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedTransfer(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedTransfer]);

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
    const reset = { startDate: todayId(), endDate: todayId(), search: '' };
    setFilters(reset);
    setAppliedFilters(reset);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil((report?.transfers.length ?? 0) / PAGE_SIZE));
  const rows = report?.transfers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];
  const hasData = !!report?.transfers.length;
  const exportExcel = async () => {
    if (!report) return;
    const csvRows: (string | number | Date)[][] = [
      ['Transfer No', 'Day ID', 'Date / Time', 'Type', 'Supplier', 'Product ID', 'Product', 'Quantity', 'Rate', 'Cost', 'Product Total', 'Transfer Total', 'Remark', 'Transfer References'],
      ...report.transfers.flatMap(entry => (entry.items.length ? entry.items : [null]).map(item => [
        entry.transferNo, entry.dayId, (entry.createdDate ? new Date(entry.createdDate) : '—'), entry.type, entry.supplier,
        item?.productId ?? '', item?.name ?? 'No product details available', item?.quantity ?? '',
        item?.price ?? '', item?.cost ?? '', item?.total ?? '', entry.finalTotal, entry.remark, entry.references.map(reference => `${reference.field}: ${reference.value}`).join(' · '),
      ])),
      ['Total', '', '', '', '', '', '', report.summary.totalQuantity, '', '', '', report.summary.totalAmount, '', ''],
    ];
    await downloadReportExcel({
      name: reportName, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
      summary: {}, rows: csvRows,
    });
  };

  return <section className="bill-report-page stock-transfer-report-page">
    <div className="bill-report-heading">
      <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><h1>Stock Transfer Report</h1><p>{outlet.name} · Stock transfers and product details.</p></div>
      <div className="bill-report-actions">
        <button type="button" onClick={() => setReloadKey(value => value + 1)} disabled={loading}><RefreshCw /> Refresh</button>
        <button type="button" onClick={exportExcel} disabled={!hasData || loading || !!error}><Download /> Export Excel</button>
        <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
      </div>
    </div>
    <div className="bill-report-filters">
      <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={value => setFilters(current => ({ ...current, startDate: value }))} /></label>
      <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={value => setFilters(current => ({ ...current, endDate: value }))} /></label>
      <label className="bill-search-filter"><span>Transfer / product search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Transfer no., reference or product" /></div></label>
      <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
    </div>
    <div className="bill-summary-grid">
      <article><span><FileText /></span><div><small>Total Transfers</small><strong>{report?.summary.totalTransfers ?? 0}</strong></div></article>
      <article><span><Package /></span><div><small>Transferred Products</small><strong>{report?.summary.totalProducts ?? 0}</strong></div></article>
      <article><span><Boxes /></span><div><small>Transferred Quantity</small><strong>{quantity(report?.summary.totalQuantity)}</strong></div></article>
      <article><span><FileText /></span><div><small>Transfer Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
    </div>
    <div className="bill-table-card">
      {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading stock transfers…</strong></div>}
      {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
      {!loading && !error && !hasData && <div className="bill-report-state"><Package /><strong>No stock transfers found for these filters.</strong><p>Choose another date range or clear the search.</p></div>}
      {!loading && !error && hasData && report && <>
        <div className="bill-table-scroll"><table>
          <thead><tr><th>Transfer No.</th><th>Date / Time</th><th>Type</th><th>Supplier</th><th>Products</th><th className="amount">Quantity</th><th className="amount">Amount</th></tr></thead>
          <tbody>{rows.map(entry => <tr key={entry.documentId} tabIndex={0} aria-label={`View stock transfer ${entry.transferNo}`} onClick={() => setSelectedTransfer(entry)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedTransfer(entry); } }}>
            <td><strong>{entry.transferNo}</strong><small>{entry.dayId}</small></td><td>{dateTime(entry.createdDate)}</td><td>{entry.type}</td><td>{entry.supplier || '—'}</td><td>{entry.items.map(item => item.name).join(', ') || '—'}</td><td className="amount">{quantity(entry.quantity)}</td><td className="amount"><strong>{money(entry.finalTotal)}</strong></td>
          </tr>)}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td colSpan={4}>{report.summary.totalTransfers} transfers</td><td className="amount">{quantity(report.summary.totalQuantity)}</td><td className="amount"><strong>{money(report.summary.totalAmount)}</strong></td></tr></tfoot>
        </table></div>
        <div className="bill-pagination"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, report.transfers.length)} of {report.transfers.length}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><strong>Page {page} of {totalPages}</strong><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>
      </>}
    </div>
    {selectedTransfer && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedTransfer(null); }}><article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`Stock transfer ${selectedTransfer.transferNo}`}>
      <header><div><span>STOCK TRANSFER DETAILS</span><h2>{selectedTransfer.transferNo}</h2><p>{dateTime(selectedTransfer.createdDate)}</p></div><button type="button" aria-label="Close transfer details" autoFocus onClick={() => setSelectedTransfer(null)}><X /></button></header>
      <div className="bill-detail-body">
        <div className="bill-detail-meta">{[
          ['Day ID', selectedTransfer.dayId], ['Transfer ID', selectedTransfer.documentId], ['Type', selectedTransfer.type],
          ['Supplier', selectedTransfer.supplier], ['Source', selectedTransfer.source], ['State', selectedTransfer.state], ['Remark', selectedTransfer.remark],
          ...selectedTransfer.references.map(reference => [reference.field, reference.value]),
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div>
        <h3>Transferred Products</h3><div className="bill-items-table"><table><thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>Cost</th><th>Total</th></tr></thead><tbody>{selectedTransfer.items.length ? selectedTransfer.items.map((item, index) => <tr key={index}><td><strong>{item.name}</strong><small>{item.productId}{item.remark ? ` · ${item.remark}` : ''}</small></td><td>{quantity(item.quantity)}</td><td>{money(item.price)}</td><td>{money(item.cost)}</td><td>{money(item.total)}</td></tr>) : <tr><td colSpan={5}>No product details available</td></tr>}</tbody></table></div>
        <div className="bill-total-detail"><div><span>Transferred Quantity</span><strong>{quantity(selectedTransfer.quantity)}</strong></div><div><span>Sub Total</span><strong>{money(selectedTransfer.total)}</strong></div><div><span>Round Off</span><strong>{money(selectedTransfer.roundOff)}</strong></div><div className="grand-total"><span>Transfer Total</span><strong>{money(selectedTransfer.finalTotal)}</strong></div></div>
      </div>
      <footer><button type="button" onClick={() => setSelectedTransfer(null)}>Close</button></footer>
    </article></div>}
  </section>;
};
