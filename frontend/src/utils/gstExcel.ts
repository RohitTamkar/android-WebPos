import type { ReportCell } from './reportExcel.ts';

export interface GstExportBill {
  billNo: string;
  dayId: string;
  createdDate: number;
  gross: number;
  items: {
    quantity: number;
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    gst: number;
  }[];
}

export const gstColumnHeadings = [
  'DATE', 'BILL NO START', 'BILL NO END', 'Total Quantity',
  'Taxable Value(5%)', '2.5% CGST', '2.5% SGST',
  'Taxable Value(12%)', '6% CGST', '6% SGST',
  'Taxable Value(18%)', '9% CGST', '9% SGST',
  'Taxable Value(28%)', '14% CGST', '14% SGST',
  'Taxable Value(8%)', '8% TAX', 'Total Sale',
];

function billDate(bill: GstExportBill): string {
  if (bill.dayId) return bill.dayId;
  if (!bill.createdDate) return '';
  const date = new Date(bill.createdDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Aggregate the GST service's calculated item amounts. Do not recalculate tax
// from the percentages in the column titles or substitute final bill totals.
function groupRow(bills: GstExportBill[]): ReportCell[] {
  const ordered = [...bills].sort((a, b) => a.createdDate - b.createdDate);
  const row: ReportCell[] = [billDate(ordered[0]), ordered[0].billNo, ordered[ordered.length - 1].billNo,
    ...Array<number>(16).fill(0)];
  const rateColumns = new Map([[5, 4], [12, 7], [18, 10], [28, 13], [8, 16]]);
  for (const bill of bills) {
    row[18] = Number(row[18]) + bill.gross;
    for (const item of bill.items) {
      row[3] = Number(row[3]) + item.quantity;
      const col = rateColumns.get(item.rate);
      if (col === undefined) continue;
      row[col] = Number(row[col]) + item.taxable;
      row[col + 1] = Number(row[col + 1]) + (item.rate === 8 ? item.gst : item.cgst);
      if (item.rate !== 8) row[col + 2] = Number(row[col + 2]) + item.sgst;
    }
  }
  return row;
}

export function gstDetailRows(bills: GstExportBill[], grouping: 'day' | 'bill'): ReportCell[][] {
  const groups = new Map<string, GstExportBill[]>();
  if (grouping === 'day') {
    for (const bill of bills) {
      const date = billDate(bill);
      const group = groups.get(date) ?? [];
      group.push(bill);
      groups.set(date, group);
    }
  }
  const rows = grouping === 'bill'
    ? bills.map(bill => groupRow([bill]))
    : [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => groupRow(group));
  const totals: ReportCell[] = ['Total', '', '', ...Array<number>(16).fill(0)];
  for (const row of rows) {
    for (let col = 3; col < 19; col++) totals[col] = Number(totals[col]) + Number(row[col]);
  }
  return [[...gstColumnHeadings], ...rows, totals];
}

// The sales report responses do not contain calculated GST splits. Read them
// from the existing GST endpoint and match by document ID so payment/device
// filters on the selected sales report remain authoritative.
export async function loadGstExportBills(
  outletId: string,
  token: string,
  selectedBills: { documentId: string; finalTotal: number }[],
  startDate: string,
  endDate: string,
  onSessionExpired: () => void,
): Promise<GstExportBill[]> {
  if (!selectedBills.length) return [];
  const params = new URLSearchParams({ startDate, endDate });
  const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/reports/gst?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    onSessionExpired();
    throw new Error('Your session has expired.');
  }
  const result = await response.json() as {
    message?: string;
    data?: { bills: (GstExportBill & { documentId: string })[] };
  };
  if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load GST details for export.');
  const gstBills = new Map(result.data.bills.map(bill => [bill.documentId, bill]));
  return selectedBills.map(bill => {
    const gstBill = gstBills.get(bill.documentId);
    if (!gstBill) throw new Error('GST details are unavailable for a selected bill. Refresh the report and try again.');
    // Sales reports already define their total after discounts and round-off.
    return { ...gstBill, gross: bill.finalTotal };
  });
}

export function gstBillSummary(bills: GstExportBill[]) {
  const items = bills.flatMap(bill => bill.items);
  return Object.fromEntries([5, 12, 18, 28, 8].flatMap(rate => {
    const matching = items.filter(item => item.rate === rate);
    return [
      [`${rate}% Taxable Value`, matching.reduce((sum, item) => sum + item.taxable, 0)],
      [`${rate}% Tax Amount`, matching.reduce((sum, item) => sum + item.gst, 0)],
    ];
  }));
}
