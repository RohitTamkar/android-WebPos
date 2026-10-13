import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, CalendarDays, ChevronLeft, ChevronRight, CreditCard, Download,
  FileText, Filter, Printer, ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';

interface BillItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  taxPercentage: number;
  remark: unknown;
}

interface BillRecord {
  documentId: string;
  billNo: string;
  serialNo: string;
  billType: string;
  dayId: string;
  createdDate: number;
  finalTotal: number;
  taxAmount: number;
  discount: number;
  serviceChargeAmount: number;
  roundOff: number;
  shiftId: string;
  deviceId: string;
  table: string;
  vehicleNo: string;
  remark: unknown;
  customerDetails: unknown;
  employee: unknown;
  payments: Record<string, number>;
  paymentModes: string[];
  items: BillItem[];
}

interface ReportResponse {
  bills: BillRecord[];
  summary: { totalBills: number; totalAmount: number; cashTotal: number; digitalTotal: number };
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

interface ReportFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  paymentType: string;
  deviceId: string;
  search: string;
}

interface BillWiseReportPageProps {
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

function dateTime(value: number): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function labelPayment(mode: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash', card: 'Card', digital: 'Digital', googlepay: 'Google Pay',
    phonepe: 'PhonePe', paytm: 'Paytm', upi: 'UPI', credit: 'Credit',
    cheque_payment_mode: 'Cheque', other: 'Other',
  };
  return labels[mode.toLowerCase()] || mode;
}

function entityLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = [record.name, record.customerName, record.employeeName, record.mobile, record.phone]
      .filter(item => typeof item === 'string' && item);
    return parts.length ? parts.join(' · ') : 'Available';
  }
  return 'Not provided';
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export const BillWiseReportPage = ({ outlet, token, onSessionExpired }: BillWiseReportPageProps) => {
  const initialFilters = useMemo<ReportFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', paymentType: '', deviceId: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [selectedBill, setSelectedBill] = useState<BillRecord | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const buildQuery = (targetPage: number, limit = 50) => {
    const params = new URLSearchParams({
      startDate: appliedFilters.startDate,
      endDate: appliedFilters.endDate,
      page: String(targetPage),
      limit: String(limit),
    });
    if (appliedFilters.shiftId) params.set('shiftId', appliedFilters.shiftId);
    if (appliedFilters.paymentType) params.set('paymentType', appliedFilters.paymentType);
    if (appliedFilters.deviceId) params.set('deviceId', appliedFilters.deviceId);
    if (appliedFilters.search) params.set('search', appliedFilters.search);
    return params;
  };

  const requestReport = async (targetPage: number, signal?: AbortSignal): Promise<ReportResponse> => {
    const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/bills?${buildQuery(targetPage)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    });
    const result = await response.json() as { success: boolean; message?: string; data?: ReportResponse };
    if (response.status === 401) {
      onSessionExpired();
      throw new Error('Your session has expired.');
    }
    if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load bills.');
    return result.data;
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    requestReport(page, controller.signal)
      .then(setReport)
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // requestReport is intentionally derived from the filter state listed below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet.id, token, appliedFilters, page, reloadKey]);

  const applyFilters = () => {
    if (filters.startDate > filters.endDate) {
      setError('Start date must be before the end date.');
      return;
    }
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(initialFilters);
    setPage(1);
    setAppliedFilters(initialFilters);
  };

  const exportExcel = async () => {
    setExporting(true);
    setError('');
    try {
      const first = await requestReport(1);
      const pages = await Promise.all(
        Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) => requestReport(index + 2))
      );
      const bills = [first, ...pages].flatMap(result => result.bills);
      const rows = [
        ['Bill No', 'Date/Time', 'Amount', 'Payment Mode', 'Bill Type', 'Shift', 'Device ID', 'Tax', 'Discount'],
        ...bills.map(bill => [
          bill.billNo, dateTime(bill.createdDate), bill.finalTotal,
          bill.paymentModes.map(labelPayment).join(' + ') || 'Unspecified', bill.billType,
          bill.shiftId, bill.deviceId, bill.taxAmount, bill.discount,
        ]),
      ];
      const csv = `\uFEFF${rows.map(row => row.map(value => csvCell(value)).join(',')).join('\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bill-wise-${outlet.name}-${appliedFilters.startDate}-${appliedFilters.endDate}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError((exportError as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="bill-report-page">
      <div className="bill-report-heading">
        <div><span>REPORTS</span><h1>Bill Wise Sale Report</h1><p>{outlet.name} · Review, filter and export completed bills.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={exporting}><Download /> {exporting ? 'Exporting…' : 'Export Excel'}</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>From date</span><div><CalendarDays /><input type="date" value={filters.startDate} onChange={event => setFilters(current => ({ ...current, startDate: event.target.value }))} /></div></label>
        <label><span>To date</span><div><CalendarDays /><input type="date" value={filters.endDate} onChange={event => setFilters(current => ({ ...current, endDate: event.target.value }))} /></div></label>
        <label><span>Shift</span><input value={filters.shiftId} onChange={event => setFilters(current => ({ ...current, shiftId: event.target.value }))} placeholder="All shifts" /></label>
        <label><span>Payment</span><select value={filters.paymentType} onChange={event => setFilters(current => ({ ...current, paymentType: event.target.value }))}><option value="">All payments</option><option value="cash">Cash</option><option value="card">Card</option><option value="googlepay">Google Pay</option><option value="phonepe">PhonePe</option><option value="paytm">Paytm</option><option value="credit">Credit</option><option value="cheque_payment_mode">Cheque</option></select></label>
        <label><span>Device ID</span><input value={filters.deviceId} onChange={event => setFilters(current => ({ ...current, deviceId: event.target.value }))} placeholder="All devices" /></label>
        <label className="bill-search-filter"><span>Bill / vehicle search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Bill no. or vehicle no." /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><ReceiptText /></span><div><small>Total Bills</small><strong>{report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><FileText /></span><div><small>Total Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
        <article><span><Banknote /></span><div><small>Cash Total</small><strong>{money(report?.summary.cashTotal)}</strong></div></article>
        <article><span><CreditCard /></span><div><small>Digital Total</small><strong>{money(report?.summary.digitalTotal)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading bills…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.bills.length === 0 && <div className="bill-report-state"><ReceiptText /><strong>No bills found for these filters.</strong><p>Choose another date or clear some filters.</p></div>}
        {!loading && !error && report && report.bills.length > 0 && (
          <div className="bill-table-scroll"><table><thead><tr><th>Bill No.</th><th>Date / Time</th><th>Payment Mode</th><th>Bill Type</th><th>Shift</th><th>Device</th><th className="amount">Amount</th></tr></thead><tbody>{report.bills.map(bill => <tr key={bill.documentId} onClick={() => setSelectedBill(bill)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setSelectedBill(bill); }}><td><strong>{bill.billNo}</strong><small>{bill.vehicleNo || bill.serialNo}</small></td><td>{dateTime(bill.createdDate)}</td><td><div className="payment-tags">{bill.paymentModes.length ? bill.paymentModes.map(mode => <span key={mode}>{labelPayment(mode)}</span>) : <span>Unspecified</span>}</div></td><td>{bill.billType}</td><td>{bill.shiftId || '—'}</td><td>{bill.deviceId || '—'}</td><td className="amount"><strong>{money(bill.finalTotal)}</strong></td></tr>)}</tbody></table></div>
        )}
        {!loading && !error && report && report.pagination.totalItems > 0 && <div className="bill-pagination"><span>Showing {(report.pagination.page - 1) * report.pagination.pageSize + 1}–{Math.min(report.pagination.page * report.pagination.pageSize, report.pagination.totalItems)} of {report.pagination.totalItems}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><strong>Page {page} of {report.pagination.totalPages}</strong><button type="button" disabled={page >= report.pagination.totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>}
      </div>

      {selectedBill && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedBill(null); }}><article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`Bill ${selectedBill.billNo}`}><header><div><span>BILL DETAILS</span><h2>{selectedBill.billNo}</h2><p>{dateTime(selectedBill.createdDate)}</p></div><button type="button" onClick={() => setSelectedBill(null)} aria-label="Close bill details"><X /></button></header><div className="bill-detail-body"><div className="bill-detail-meta"><div><span>Bill type</span><strong>{selectedBill.billType}</strong></div><div><span>Shift</span><strong>{selectedBill.shiftId || '—'}</strong></div><div><span>Device</span><strong>{selectedBill.deviceId || '—'}</strong></div><div><span>Table</span><strong>{selectedBill.table || '—'}</strong></div><div><span>Customer</span><strong>{entityLabel(selectedBill.customerDetails)}</strong></div><div><span>Employee</span><strong>{entityLabel(selectedBill.employee)}</strong></div><div><span>Remark</span><strong>{entityLabel(selectedBill.remark)}</strong></div><div><span>Vehicle</span><strong>{selectedBill.vehicleNo || '—'}</strong></div></div><h3>Items</h3><div className="bill-items-table"><table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>{selectedBill.items.length ? selectedBill.items.map((item, index) => <tr key={`${item.name}-${index}`}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.price)}</td><td>{money(item.total)}</td></tr>) : <tr><td colSpan={4}>No item details available</td></tr>}</tbody></table></div><div className="bill-payment-detail"><h3>Payments</h3>{Object.entries(selectedBill.payments).filter(([, amount]) => amount > 0).map(([mode, amount]) => <div key={mode}><span>{labelPayment(mode)}</span><strong>{money(amount)}</strong></div>)}</div><div className="bill-total-detail"><div><span>Discount</span><strong>{money(selectedBill.discount)}</strong></div><div><span>Tax</span><strong>{money(selectedBill.taxAmount)}</strong></div><div><span>Service charge</span><strong>{money(selectedBill.serviceChargeAmount)}</strong></div><div className="grand-total"><span>Grand Total</span><strong>{money(selectedBill.finalTotal)}</strong></div></div></div><footer><button type="button" onClick={() => window.print()}><Printer /> Print / Save PDF</button></footer></article></div>}
    </section>
  );
};
