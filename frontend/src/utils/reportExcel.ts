import type ExcelJS from 'exceljs';

export type ReportCell = string | number | Date;
export const summaryLabels = [
  'Shop Name', 'Date & Time', 'Report Date Range', 'Bill No Range', 'GSTIN',
  'TOTAL SALE', 'TOTAL TAX', 'Cash', 'Digital', 'Credit', 'Card', 'Google Pay',
  'PhonePe', 'Paytm', 'Cheque', 'Other', 'Loyalty Point',
  '5% Taxable Value', '5% Tax Amount', '12% Taxable Value', '12% Tax Amount',
  '18% Taxable Value', '18% Tax Amount', '28% Taxable Value', '28% Tax Amount',
  '8% Taxable Value', '8% Tax Amount',
] as const;
export type ReportSummary = Partial<Record<typeof summaryLabels[number], ReportCell>>;

export interface SalesTaxBreakdown {
  rate: number | null;
  quantity: number;
  amount: number;
  taxableValue?: number;
  taxAmount: number;
  productCount?: number;
}

interface TaxedSalesRow {
  quantity: number;
  amount: number;
  taxRate?: string | number;
  taxAmount?: number;
  productCount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
}

export function salesTaxRows(row: TaxedSalesRow): SalesTaxBreakdown[] {
  if (row.taxBreakdown?.length) return row.taxBreakdown;
  // Older responses cannot reliably split a combined rate label. Preserve Sale.
  const rate = typeof row.taxRate === 'string' && /^\d+(\.\d+)?%$/.test(row.taxRate)
    ? Number(row.taxRate.slice(0, -1)) : null;
  return [{ rate, quantity: row.quantity, amount: row.amount, taxAmount: row.taxAmount ?? 0, productCount: row.productCount }];
}

export function salesTaxSummary(rows: TaxedSalesRow[]): ReportSummary {
  const groups = rows.flatMap(salesTaxRows);
  const summary: ReportSummary = { 'TOTAL TAX': groups.reduce((sum, group) => sum + group.taxAmount, 0) };
  for (const rate of [5, 12, 18, 28, 8] as const) {
    const matching = groups.filter(group => group.rate === rate);
    summary[`${rate}% Taxable Value`] = matching.reduce((sum, group) => sum + (group.taxableValue ?? 0), 0);
    summary[`${rate}% Tax Amount`] = matching.reduce((sum, group) => sum + group.taxAmount, 0);
  }
  return summary;
}

export interface ReportExport {
  name: string;
  outlet: { name: string; gstin?: string };
  startDate?: string;
  endDate?: string;
  summary?: ReportSummary;
  rows: ReportCell[][];
  now?: Date;
}

// Use only payment keys returned by the existing report service. Digital follows
// the bill report's existing grouping; its component modes are also shown separately.
export function paymentSummary(payments: Record<string, number>): ReportSummary {
  const labels: Record<string, typeof summaryLabels[number]> = {
    cash: 'Cash', credit: 'Credit', card: 'Card', googlepay: 'Google Pay',
    phonepe: 'PhonePe', paytm: 'Paytm', cheque_payment_mode: 'Cheque', other: 'Other',
  };
  const summary: ReportSummary = Object.fromEntries(Object.values(labels).map(label => [label, 0]));
  let digital = 0;
  for (const [mode, amount] of Object.entries(payments)) {
    const key = mode.toLowerCase();
    const label = labels[key];
    if (label) summary[label] = Number(summary[label] ?? 0) + amount;
    if (['digital', 'card', 'googlepay', 'phonepe', 'paytm', 'upi'].includes(key)) digital += amount;
  }
  summary.Digital = digital;
  return summary;
}

export function sumPayments(records: { payments: Record<string, number> }[]): ReportSummary {
  const payments: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record.payments)) payments[key] = (payments[key] ?? 0) + value;
  }
  return paymentSummary(payments);
}

export function billRange(bills: { billNo: string; createdDate: number }[]): string {
  const ordered = [...bills].sort((a, b) => a.createdDate - b.createdDate);
  return ordered.length ? `${ordered[0].billNo} to ${ordered[ordered.length - 1].billNo}` : 'N/A';
}

export function gstSummary(report: {
  summary: { gst: number; gross: number };
  rates?: { rate: number; taxable: number; gst: number }[];
}): ReportSummary {
  const summary: ReportSummary = { 'TOTAL SALE': report.summary.gross, 'TOTAL TAX': report.summary.gst };
  if (report.rates) {
    for (const rate of [5, 12, 18, 28, 8] as const) {
      const matching = report.rates.filter(row => row.rate === rate);
      summary[`${rate}% Taxable Value`] = matching.reduce((sum, row) => sum + row.taxable, 0);
      summary[`${rate}% Tax Amount`] = matching.reduce((sum, row) => sum + row.gst, 0);
    }
  }
  return summary;
}

const amountFormat = '#,##0.00;[Red]-#,##0.00';
const border: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD9E1E8' } },
  bottom: { style: 'thin', color: { argb: 'FFD9E1E8' } },
  left: { style: 'thin', color: { argb: 'FFD9E1E8' } },
  right: { style: 'thin', color: { argb: 'FFD9E1E8' } },
};

export async function createReportWorkbook(options: ReportExport): Promise<ExcelJS.Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  const width = options.rows.reduce((max, row) => Math.max(max, row.length), 2);
  sheet.mergeCells(1, 1, 1, width);
  sheet.getCell('A1').value = options.name;
  sheet.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell('A1').font = { bold: true, size: 20, color: { argb: 'FF173B53' } };
  sheet.getRow(1).height = 32;
  const summary: ReportSummary = {
    ...options.summary,
    'Shop Name': options.outlet.name,
    'Date & Time': options.now ?? new Date(),
    'Report Date Range': options.startDate ? `${options.startDate} to ${options.endDate ?? options.startDate}` : 'N/A',
    GSTIN: options.outlet.gstin || 'N/A',
  };
  for (const label of summaryLabels) {
    const rawValue = summary[label];
    const value = rawValue == null
      || typeof rawValue === 'string' && (!rawValue.trim() || rawValue.trim() === 'N/A')
      || typeof rawValue === 'number' && !Number.isFinite(rawValue)
      ? 0 : rawValue;
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.eachCell(cell => {
      cell.border = border;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    if (typeof value === 'number' && summaryLabels.indexOf(label) >= 5) row.getCell(2).numFmt = amountFormat;
    if (value instanceof Date) row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
  }
  // Summary ends at row 28; rows 29–31 are always blank. Keep any blank rows
  // inside the existing detail layout, but start its first content at row 32.
  const firstContent = options.rows.findIndex(row => row.length > 0);
  const detailRows = firstContent < 0 ? [] : options.rows.slice(firstContent);
  let headers = detailRows[0] ?? [];
  detailRows.forEach((values, index) => {
    const row = sheet.getRow(32 + index);
    row.values = values.map(value => typeof value === 'string' && value.trim().toUpperCase() === 'N/A' ? 0 : value);
    const heading = index === 0 || values.every(value => typeof value === 'string') && values.length > 1;
    const total = values.slice(0, 2).some(value => value === 'Total');
    row.eachCell(cell => {
      cell.border = border;
      cell.alignment = { horizontal: 'right' };
      if (heading || total) cell.font = { bold: true };
      if (heading) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0F5' } };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.###';
      if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
    });
    // Column headings determine presentation only; values and calculations stay intact.
    if (heading) headers = values;
    values.forEach((value, col) => {
      if (typeof value === 'number' && /share\s*%/i.test(String(headers[col]))) row.getCell(col + 1).numFmt = '0.00"%"';
      if (typeof value === 'number' && /amount|taxable|cgst|sgst|igst|gst|sale|price|rate|cost|tax|discount|expenses|balance|total|cash|digital|credit/i.test(String(headers[col]))
        && !/bills|products|qty|quantity|share|count/i.test(String(headers[col]))) row.getCell(col + 1).numFmt = amountFormat;
    });
  });
  for (let col = 1; col <= width; col++) {
    sheet.getColumn(col).width = Math.min(48, detailRows.reduce(
      (max, row) => Math.max(max, String(row[col - 1] ?? '').length + 2), col <= 2 ? 30 : 16));
  }
  return workbook;
}

export function reportFilename(options: Pick<ReportExport, 'name' | 'startDate' | 'endDate'>): string {
  const name = options.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${name}${options.startDate ? `_${options.startDate}_to_${options.endDate ?? options.startDate}` : ''}.xlsx`;
}

export async function downloadReportExcel(options: ReportExport): Promise<void> {
  const workbook = await createReportWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = reportFilename(options);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
