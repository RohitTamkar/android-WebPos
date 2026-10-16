import { gstDetailRows, type GstExportBill } from '../utils/gstExcel.ts';
import { downloadReportExcel, gstSummary, billRange } from '../utils/reportExcel.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { useEffect, useState } from 'react';
import {
  BadgeIndianRupee, Download, FileText,
  Percent, Printer, ReceiptText, RefreshCw,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './GstReportPage.css';
import './GstDaywiseReportPage.css';

interface GstTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gst: number;
  gross: number;
}

interface GstReportResponse {
  summary: GstTotals & { totalBills: number; gstBills: number };
  rates: { rate: number; taxable: number; gst: number }[];
  bills: GstExportBill[];
}

interface GstDaywiseReportPageProps {
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

export const GstDaywiseReportPage = ({ outlet, token, onSessionExpired, reportName = 'GST Report Day Wise' }: GstDaywiseReportPageProps) => {
  const [dayId, setDayId] = useState(todayId);
  const [report, setReport] = useState<GstReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startDate: dayId, endDate: dayId });
    // Clear the previous day's totals while synchronizing with the GST service.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true);
    setError('');
    setReport(null);
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
      })
      .catch(requestError => {
        if (!controller.signal.aborted) setError((requestError as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [outlet.id, token, reloadKey, dayId, onSessionExpired]);

  const exportExcel = async () => {
    if (!report) return;
    const rows = gstDetailRows(report.bills, 'day');
    await downloadReportExcel({
      name: reportName, outlet, startDate: dayId, endDate: dayId,
      summary: { ...gstSummary(report), 'Bill No Range': billRange(report.bills) }, rows,
    });
  };

  const hasData = !!report && report.summary.totalBills > 0;

  return (
    <section className="bill-report-page gst-report-page gst-daywise-report-page">
      <div className="bill-report-heading">
        <div><span>REPORTS</span><h1>GST Report Day Wise</h1><p>{outlet.name} · GST summary across all bills and shifts for the selected date.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!hasData || loading || !!error}><Download /> Export Excel</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>Report date</span><ReportDateInput aria-label="Report date" value={dayId} onChange={event => { if (event.target.value) setDayId(event.target.value); }} /></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" disabled={loading} onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Refresh</button></div>
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
        {!loading && !error && report && !hasData && <div className="bill-report-state"><Percent /><strong>No bills found for this date.</strong><p>Choose another date or refresh to load recorded bills.</p></div>}
        {!loading && !error && report && hasData && <div className="bill-table-scroll"><table>
          <thead><tr><th>Day ID</th><th>All Bills</th><th>GST Bills</th><th className="amount">Taxable Value</th><th className="amount">CGST</th><th className="amount">SGST</th><th className="amount">IGST</th><th className="amount">Total GST</th><th className="amount">Amount incl. GST</th></tr></thead>
          <tbody><tr><td className="gst-plain-cell"><strong>{dayId}</strong></td><td>{report.summary.totalBills}</td><td>{report.summary.gstBills}</td><td className="amount">{money(report.summary.taxable)}</td><td className="amount">{money(report.summary.cgst)}</td><td className="amount">{money(report.summary.sgst)}</td><td className="amount">{money(report.summary.igst)}</td><td className="amount"><strong>{money(report.summary.gst)}</strong></td><td className="amount"><strong>{money(report.summary.gross)}</strong></td></tr></tbody>
        </table></div>}
      </div>
    </section>
  );
};
