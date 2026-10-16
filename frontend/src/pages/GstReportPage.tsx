import { gstDetailRows } from '../utils/gstExcel.ts';
import { downloadReportExcel, billRange, gstSummary } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  BadgeIndianRupee, ChevronLeft, ChevronRight, Download, FileText,
  Filter, Percent, Printer, ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './ProductWiseReportPage.css';
import './GstReportPage.css';

interface GstTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gst: number;
  gross: number;
}

interface GstRateRow extends GstTotals {
  rate: number;
  itemCount: number;
  billCount: number;
}

interface GstBillItem extends GstTotals {
  name: string;
  code: string;
  quantity: number;
  price: number;
  rate: number;
}

interface GstBillRow extends GstTotals {
  documentId: string;
  billNo: string;
  dayId: string;
  createdDate: number;
  taxType: string;
  shiftId: string;
  rates: number[];
  finalTotal: number;
  items: GstBillItem[];
}

interface GstReportResponse {
  rates: GstRateRow[];
  bills: GstBillRow[];
  summary: GstTotals & { totalBills: number; gstBills: number };
}

interface GstFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  taxType: string;
  search: string;
}

type GstView = 'rate' | 'bill';

const PAGE_SIZE = 50;

interface GstReportPageProps {
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

function dateTime(value: number): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}%`;
}

function taxTypeLabel(taxType: string): string {
  const key = taxType.toLowerCase();
  if (key === 'inclusive') return 'Inclusive';
  if (key === 'exclusive') return 'Exclusive';
  if (key === 'notax') return 'No Tax';
  return taxType || 'No Tax';
}

export const GstReportPage = ({ outlet, token, onSessionExpired, reportName = 'GST Report' }: GstReportPageProps) => {
  const initialFilters = useMemo<GstFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', taxType: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<GstReportResponse | null>(null);
  const [view, setView] = useState<GstView>('rate');
  const [selectedBill, setSelectedBill] = useState<GstBillRow | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters, setPage);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startDate: appliedFilters.startDate, endDate: appliedFilters.endDate });
    if (appliedFilters.shiftId) params.set('shiftId', appliedFilters.shiftId);
    if (appliedFilters.taxType) params.set('taxType', appliedFilters.taxType);
    if (appliedFilters.search) params.set('search', appliedFilters.search);

    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/gst?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: GstReportResponse };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load the GST report.');
        setReport(result.data);
        setPage(1);
      })
      .catch(requestError => {
        if (!controller.signal.aborted) setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, appliedFilters, reloadKey]);

  const totalPages = Math.max(1, Math.ceil((report?.bills.length ?? 0) / PAGE_SIZE));
  const pagedBills = report?.bills.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];

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
    const rows = gstDetailRows(report.bills, view === 'bill' ? 'bill' : 'day');
    await downloadReportExcel({
      name: reportName, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
      summary: { ...gstSummary(report), 'Bill No Range': billRange(report.bills) }, rows,
    });
  };

  const hasData = !!report && report.bills.length > 0;

  return (
    <section className="bill-report-page product-report-page gst-report-page">
      <div className="bill-report-heading">
        <div><span>REPORTS</span><h1>GST Report</h1><p>{outlet.name} · Taxable value, CGST, SGST, IGST and GST-inclusive totals.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!hasData}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={event => setFilters(current => ({ ...current, startDate: event.target.value }))} /></label>
        <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={event => setFilters(current => ({ ...current, endDate: event.target.value }))} /></label>
        <label><span>Shift</span><input value={filters.shiftId} onChange={event => setFilters(current => ({ ...current, shiftId: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="All shifts" /></label>
        <label><span>Tax type</span><select value={filters.taxType} onChange={event => setFilters(current => ({ ...current, taxType: event.target.value }))}><option value="">All tax types</option><option value="inclusive">Inclusive</option><option value="exclusive">Exclusive</option><option value="notax">No Tax</option></select></label>
        <label><span>Bill search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Bill no." /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><FileText /></span><div><small>Taxable Value</small><strong>{money(report?.summary.taxable)}</strong></div></article>
        <article><span><Percent /></span><div><small>Total GST</small><strong>{money(report?.summary.gst)}</strong></div></article>
        <article><span><BadgeIndianRupee /></span><div><small>Amount incl. GST</small><strong>{money(report?.summary.gross)}</strong></div></article>
        <article><span><ReceiptText /></span><div><small>GST Bills · All Bills</small><strong>{report?.summary.gstBills ?? 0} · {report?.summary.totalBills ?? 0}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading GST report…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report && !hasData && <div className="bill-report-state"><Percent /><strong>No bills found for these filters.</strong><p>Choose another date or clear some filters.</p></div>}
        {!loading && !error && report && hasData && (
          <>
            <div className="product-sort-bar"><span>View</span><button type="button" className={view === 'rate' ? 'active' : ''} onClick={() => setView('rate')}>By GST rate</button><button type="button" className={view === 'bill' ? 'active' : ''} onClick={() => setView('bill')}>By bill</button></div>
            {view === 'rate' ? (
              <div className="bill-table-scroll"><table><thead><tr><th>GST Rate</th><th>Bills</th><th>Item Qty</th><th className="amount">Taxable Value</th><th className="amount">CGST</th><th className="amount">SGST</th><th className="amount">IGST</th><th className="amount">Total GST</th><th className="amount">Amount incl. GST</th></tr></thead><tbody>{report.rates.map(row => <tr key={row.rate}><td className="gst-plain-cell"><span className={`gst-rate ${row.rate > 0 ? '' : 'zero'}`}>{rateLabel(row.rate)}</span></td><td>{row.billCount}</td><td>{row.itemCount}</td><td className="amount">{money(row.taxable)}</td><td className="amount">{money(row.cgst)}</td><td className="amount">{money(row.sgst)}</td><td className="amount">{money(row.igst)}</td><td className="amount">{money(row.gst)}</td><td className="amount"><strong>{money(row.gross)}</strong></td></tr>)}</tbody><tfoot><tr><td className="gst-plain-cell"><strong>Total</strong></td><td>{report.summary.totalBills}</td><td /><td className="amount">{money(report.summary.taxable)}</td><td className="amount">{money(report.summary.cgst)}</td><td className="amount">{money(report.summary.sgst)}</td><td className="amount">{money(report.summary.igst)}</td><td className="amount">{money(report.summary.gst)}</td><td className="amount"><strong>{money(report.summary.gross)}</strong></td></tr></tfoot></table></div>
            ) : (
              <>
                <div className="bill-table-scroll"><table><thead><tr><th>Bill No.</th><th>Date / Time</th><th>Tax Type</th><th>GST Rates</th><th className="amount">Taxable Value</th><th className="amount">CGST</th><th className="amount">SGST</th><th className="amount">IGST</th><th className="amount">Total GST</th><th className="amount">Amount incl. GST</th></tr></thead><tbody>{pagedBills.map(bill => <tr key={bill.documentId} className="gst-bill-row" onClick={() => setSelectedBill(bill)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setSelectedBill(bill); }}><td><strong>{bill.billNo}</strong><small>{bill.dayId}</small></td><td>{dateTime(bill.createdDate)}</td><td>{taxTypeLabel(bill.taxType)}</td><td><div className="payment-tags">{bill.rates.length ? bill.rates.map(rate => <span key={rate}>{rateLabel(rate)}</span>) : <span>—</span>}</div></td><td className="amount">{money(bill.taxable)}</td><td className="amount">{money(bill.cgst)}</td><td className="amount">{money(bill.sgst)}</td><td className="amount">{money(bill.igst)}</td><td className="amount">{money(bill.gst)}</td><td className="amount"><strong>{money(bill.gross)}</strong></td></tr>)}</tbody><tfoot><tr><td className="gst-plain-cell"><strong>Total</strong></td><td colSpan={3}>{report.summary.totalBills} bills</td><td className="amount">{money(report.summary.taxable)}</td><td className="amount">{money(report.summary.cgst)}</td><td className="amount">{money(report.summary.sgst)}</td><td className="amount">{money(report.summary.igst)}</td><td className="amount">{money(report.summary.gst)}</td><td className="amount"><strong>{money(report.summary.gross)}</strong></td></tr></tfoot></table></div>
                <div className="bill-pagination"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, report.bills.length)} of {report.bills.length}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><strong>Page {page} of {totalPages}</strong><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>
              </>
            )}
          </>
        )}
      </div>

      {selectedBill && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedBill(null); }}><article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`GST details for bill ${selectedBill.billNo}`}><header><div><span>GST BILL DETAILS</span><h2>{selectedBill.billNo}</h2><p>{dateTime(selectedBill.createdDate)}</p></div><button type="button" onClick={() => setSelectedBill(null)} aria-label="Close bill details"><X /></button></header><div className="bill-detail-body"><div className="bill-detail-meta"><div><span>Day ID</span><strong>{selectedBill.dayId || '—'}</strong></div><div><span>Tax type</span><strong>{taxTypeLabel(selectedBill.taxType)}</strong></div><div><span>Shift</span><strong>{selectedBill.shiftId || '—'}</strong></div><div><span>GST rates</span><strong>{selectedBill.rates.length ? selectedBill.rates.map(rateLabel).join(' / ') : '—'}</strong></div></div><h3>Items</h3><div className="bill-items-table gst-items-table"><table><thead><tr><th>Product</th><th>Qty</th><th>GST %</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>GST</th><th>Amount</th></tr></thead><tbody>{selectedBill.items.length ? selectedBill.items.map((item, index) => <tr key={`${item.name}-${index}`}><td><strong>{item.name}</strong>{item.code && <small>Code {item.code}</small>}</td><td>{item.quantity} × {money(item.price)}</td><td><span className={`gst-rate ${item.rate > 0 ? '' : 'zero'}`}>{rateLabel(item.rate)}</span></td><td>{money(item.taxable)}</td><td>{money(item.cgst)}</td><td>{money(item.sgst)}</td><td>{money(item.igst)}</td><td>{money(item.gst)}</td><td><strong>{money(item.gross)}</strong></td></tr>) : <tr><td colSpan={9}>No item details available</td></tr>}</tbody></table></div><div className="bill-total-detail"><div><span>Taxable value</span><strong>{money(selectedBill.taxable)}</strong></div><div><span>CGST</span><strong>{money(selectedBill.cgst)}</strong></div><div><span>SGST</span><strong>{money(selectedBill.sgst)}</strong></div><div><span>IGST</span><strong>{money(selectedBill.igst)}</strong></div><div><span>Total GST</span><strong>{money(selectedBill.gst)}</strong></div><div className="grand-total"><span>Amount incl. GST</span><strong>{money(selectedBill.gross)}</strong></div>{Math.abs(selectedBill.finalTotal - selectedBill.gross) >= 0.01 && <div><span>Bill final total (after discount, charges, round-off)</span><strong>{money(selectedBill.finalTotal)}</strong></div>}</div></div><footer><button type="button" onClick={() => window.print()}><Printer /> Print / Save PDF</button></footer></article></div>}
    </section>
  );
};
