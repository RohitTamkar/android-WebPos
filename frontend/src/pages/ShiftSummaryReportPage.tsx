import { downloadReportExcel, sumPayments } from '../utils/reportExcel.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, Clock3, CreditCard, Download, Filter, Printer,
  RefreshCw, TrendingUp, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './ShiftSummaryReportPage.css';

interface ShiftRecord {
  id: string;
  dayId: string;
  shiftNo: number;
  deviceId: string;
  inActive: boolean;
  startTime: number;
  endTime: number;
  startBillNo: string;
  lastBillNo: string;
  lastBillTime: number;
  billCount: number;
  billDeletesNumber: number;
  billDeletesAmount: number;
  openingAmt: number;
  totalSale: number;
  cashSale: number;
  digitalSale: number;
  creditSale: number;
  subTotalBill: number;
  discount: number;
  tax: number;
  gstTotal: number;
  vatTotal: number;
  refundAmount: number;
  extraCharges: number;
  serviceChargeAmount: number;
  roundOff: number;
  expensesAmtTotal: number;
  expCash: number;
  expDigital: number;
  advanceAmtTotal: number;
  customerReceiveAmtTotal: number;
  receiveAmtTotal: number;
  swiggyTotal: number;
  zomatoTotal: number;
  payments: Record<string, number>;
}

interface ShiftReportResponse {
  shifts: ShiftRecord[];
  summary: {
    totalShifts: number; totalBills: number; totalSale: number; cashSale: number;
    digitalSale: number; creditSale: number; expenses: number;
  };
}

interface ShiftFilters {
  startDate: string;
  endDate: string;
  dayId: string;
  shiftNo: string;
  deviceId: string;
}

interface ShiftSummaryReportPageProps {
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

function labelPayment(mode: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash', card: 'Card', digital: 'Digital', googlepay: 'Google Pay',
    phonepe: 'PhonePe', paytm: 'Paytm', upi: 'UPI', credit: 'Credit',
    cheque_payment_mode: 'Cheque', other: 'Other',
  };
  return labels[mode.toLowerCase()] || mode;
}

// The POS does not always record an end time, so only today's unclosed shifts count as open.
function shiftStatus(shift: ShiftRecord): 'Open' | 'Closed' | 'Not closed' {
  if (shift.endTime) return 'Closed';
  return shift.dayId === todayId() ? 'Open' : 'Not closed';
}

function endLabel(shift: ShiftRecord): string {
  if (shift.endTime) return dateTime(shift.endTime);
  return shiftStatus(shift) === 'Open' ? 'In progress' : `Last bill ${dateTime(shift.lastBillTime)}`;
}

function cashInHand(shift: ShiftRecord): number {
  return shift.openingAmt + shift.cashSale - shift.expCash;
}

export const ShiftSummaryReportPage = ({ outlet, token, onSessionExpired, reportName = 'Shift Summary Report' }: ShiftSummaryReportPageProps) => {
  const initialFilters = useMemo<ShiftFilters>(() => ({
    startDate: todayId(), endDate: todayId(), dayId: '', shiftNo: '', deviceId: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState<ShiftReportResponse | null>(null);
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startDate: appliedFilters.startDate, endDate: appliedFilters.endDate });
    if (appliedFilters.dayId) params.set('dayId', appliedFilters.dayId);
    if (appliedFilters.shiftNo) params.set('shiftNo', appliedFilters.shiftNo);
    if (appliedFilters.deviceId) params.set('deviceId', appliedFilters.deviceId);

    setLoading(true);
    setError('');
    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/shifts?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: ShiftReportResponse };
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load shifts.');
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

  const applyFilters = () => {
    const dateError = filters.dayId ? reportDateError(filters.dayId, filters.dayId) : reportDateError(filters.startDate, filters.endDate);
    if (dateError) {
      setError(dateError);
      return;
    }
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    const reset = { ...initialFilters, startDate: todayId(), endDate: todayId() };
    setFilters(reset);
    setAppliedFilters(reset);
  };

  const exportExcel = async () => {
    if (!report) return;
    const rows = [
      ['Day ID', 'Shift No', 'Status', 'Device ID', 'Start Time', 'End Time', 'Start Bill', 'Last Bill', 'Bill Count',
        'Opening Amount', 'Cash Sale', 'Digital Sale', 'Credit Sale', 'Discount', 'Tax', 'Expenses', 'Cash In Hand', 'Total Sale'],
      ...report.shifts.map(shift => [
        shift.dayId, shift.shiftNo, shiftStatus(shift), shift.deviceId,
        (shift.startTime ? new Date(shift.startTime) : '—'), (shift.endTime ? new Date(shift.endTime) : '—'), shift.startBillNo, shift.lastBillNo, shift.billCount,
        shift.openingAmt, shift.cashSale, shift.digitalSale, shift.creditSale, shift.discount, shift.tax,
        shift.expensesAmtTotal, cashInHand(shift), shift.totalSale,
      ]),
    ];
    await downloadReportExcel({
      name: reportName, outlet, startDate: appliedFilters.dayId || appliedFilters.startDate, endDate: appliedFilters.dayId || appliedFilters.endDate,
      summary: {
        ...sumPayments(report.shifts),
        'TOTAL SALE': report.summary.totalSale,
        'TOTAL TAX': report.shifts.reduce((sum, shift) => sum + shift.tax, 0),
        Cash: report.summary.cashSale,
        Digital: report.summary.digitalSale,
        Credit: report.summary.creditSale,
        'Bill No Range': report.shifts.filter(shift => shift.startBillNo || shift.lastBillNo)
          .map(shift => `${shift.startBillNo} to ${shift.lastBillNo}`).join('; ') || 'N/A',
      },
      rows,
    });
  };

  return (
    <section className="bill-report-page shift-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><h1>Shift Summary Report</h1><p>{outlet.name} · Shift-wise sales by day ID.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!report?.shifts.length}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={value => setFilters(current => ({ ...current, startDate: value, dayId: '' }))} /></label>
        <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={value => setFilters(current => ({ ...current, endDate: value, dayId: '' }))} /></label>
        <label><span>Day ID</span><ReportDateInput aria-label="Day ID" value={filters.dayId} onChange={value => setFilters(current => ({ ...current, dayId: value }))} /></label>
        <label><span>Shift No.</span><input type="number" min="1" value={filters.shiftNo} onChange={event => setFilters(current => ({ ...current, shiftNo: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="All shifts" /></label>
        <label><span>Device ID</span><input value={filters.deviceId} onChange={event => setFilters(current => ({ ...current, deviceId: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="All devices" /></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><Clock3 /></span><div><small>Total Shifts · Bills</small><strong>{report?.summary.totalShifts ?? 0} · {report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><TrendingUp /></span><div><small>Total Sale</small><strong>{money(report?.summary.totalSale)}</strong></div></article>
        <article><span><Banknote /></span><div><small>Cash Sale</small><strong>{money(report?.summary.cashSale)}</strong></div></article>
        <article><span><CreditCard /></span><div><small>Digital Sale</small><strong>{money(report?.summary.digitalSale)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state"><RefreshCw className="bill-report-spinner" /><strong>Loading shifts…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.shifts.length === 0 && <div className="bill-report-state"><Clock3 /><strong>No shifts found for these filters.</strong><p>Choose another day ID or date range.</p></div>}
        {!loading && !error && report && report.shifts.length > 0 && (
          <div className="bill-table-scroll"><table><thead><tr><th>Day ID</th><th>Shift</th><th>Status</th><th>Start / End</th><th>Bills</th><th>Device</th><th className="amount">Cash</th><th className="amount">Digital</th><th className="amount">Credit</th><th className="amount">Expenses</th><th className="amount">Total Sale</th></tr></thead><tbody>{report.shifts.map(shift => <tr key={shift.id} onClick={() => setSelectedShift(shift)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setSelectedShift(shift); }}><td><strong>{shift.dayId || '—'}</strong><small>{shift.id}</small></td><td>Shift {shift.shiftNo}</td><td><span className={`shift-status ${shiftStatus(shift).toLowerCase().replace(' ', '-')}`}>{shiftStatus(shift)}</span></td><td><div className="shift-times"><span>{dateTime(shift.startTime)}</span><small>{endLabel(shift)}</small></div></td><td><div className="shift-times"><span>{shift.billCount} bills</span><small>{shift.startBillNo && shift.lastBillNo ? `${shift.startBillNo} – ${shift.lastBillNo}` : '—'}</small></div></td><td>{shift.deviceId || '—'}</td><td className="amount">{money(shift.cashSale)}</td><td className="amount">{money(shift.digitalSale)}</td><td className="amount">{money(shift.creditSale)}</td><td className="amount">{money(shift.expensesAmtTotal)}</td><td className="amount"><strong>{money(shift.totalSale)}</strong></td></tr>)}</tbody><tfoot><tr><td><strong>Total</strong></td><td colSpan={3}>{report.summary.totalShifts} shifts</td><td>{report.summary.totalBills} bills</td><td /><td className="amount">{money(report.summary.cashSale)}</td><td className="amount">{money(report.summary.digitalSale)}</td><td className="amount">{money(report.summary.creditSale)}</td><td className="amount">{money(report.summary.expenses)}</td><td className="amount"><strong>{money(report.summary.totalSale)}</strong></td></tr></tfoot></table></div>
        )}
      </div>

      {selectedShift && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedShift(null); }}><article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`Shift ${selectedShift.shiftNo} on ${selectedShift.dayId}`}><header><div><span>SHIFT SUMMARY</span><h2>Shift {selectedShift.shiftNo} · {selectedShift.dayId}</h2><p>{dateTime(selectedShift.startTime)} → {endLabel(selectedShift)}</p></div><button type="button" onClick={() => setSelectedShift(null)} aria-label="Close shift details"><X /></button></header><div className="bill-detail-body"><div className="bill-detail-meta"><div><span>Day ID</span><strong>{selectedShift.dayId || '—'}</strong></div><div><span>Shift ID</span><strong>{selectedShift.id}</strong></div><div><span>Status</span><strong>{shiftStatus(selectedShift)}</strong></div><div><span>Device</span><strong>{selectedShift.deviceId || '—'}</strong></div><div><span>Bill range</span><strong>{selectedShift.startBillNo || '—'} – {selectedShift.lastBillNo || '—'}</strong></div><div><span>Last bill time</span><strong>{dateTime(selectedShift.lastBillTime)}</strong></div><div><span>Bill count</span><strong>{selectedShift.billCount}</strong></div><div><span>Deleted bills</span><strong>{selectedShift.billDeletesNumber} · {money(selectedShift.billDeletesAmount)}</strong></div></div><div className="bill-payment-detail"><h3>Payments</h3>{Object.entries(selectedShift.payments).filter(([, amount]) => amount > 0).map(([mode, amount]) => <div key={mode}><span>{labelPayment(mode)}</span><strong>{money(amount)}</strong></div>)}{selectedShift.swiggyTotal > 0 && <div><span>Swiggy</span><strong>{money(selectedShift.swiggyTotal)}</strong></div>}{selectedShift.zomatoTotal > 0 && <div><span>Zomato</span><strong>{money(selectedShift.zomatoTotal)}</strong></div>}{!Object.values(selectedShift.payments).some(amount => amount > 0) && <div><span>No payments recorded</span><strong>{money(0)}</strong></div>}</div><div className="bill-payment-detail"><h3>Cash Drawer</h3><div><span>Opening amount</span><strong>{money(selectedShift.openingAmt)}</strong></div><div><span>Cash sale</span><strong>{money(selectedShift.cashSale)}</strong></div><div><span>Cash expenses</span><strong>− {money(selectedShift.expCash)}</strong></div><div><span>Digital expenses</span><strong>{money(selectedShift.expDigital)}</strong></div><div><span>Advance received</span><strong>{money(selectedShift.advanceAmtTotal)}</strong></div><div><span>Customer receipts</span><strong>{money(selectedShift.customerReceiveAmtTotal)}</strong></div><div><span>Cash in hand</span><strong>{money(cashInHand(selectedShift))}</strong></div></div><div className="bill-total-detail"><div><span>Sub total</span><strong>{money(selectedShift.subTotalBill)}</strong></div><div><span>Discount</span><strong>{money(selectedShift.discount)}</strong></div><div><span>Tax (GST {money(selectedShift.gstTotal)} · VAT {money(selectedShift.vatTotal)})</span><strong>{money(selectedShift.tax)}</strong></div><div><span>Service charge</span><strong>{money(selectedShift.serviceChargeAmount)}</strong></div><div><span>Extra charges</span><strong>{money(selectedShift.extraCharges)}</strong></div><div><span>Refunds</span><strong>{money(selectedShift.refundAmount)}</strong></div><div><span>Round off</span><strong>{money(selectedShift.roundOff)}</strong></div><div className="grand-total"><span>Total Sale</span><strong>{money(selectedShift.totalSale)}</strong></div></div></div><footer><button type="button" onClick={() => window.print()}><Printer /> Print / Save PDF</button></footer></article></div>}
    </section>
  );
};
