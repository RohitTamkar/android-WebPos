import type ExcelJS from 'exceljs';

export interface ShiftDashboardData {
  id: string;
  dayId: string;
  shiftNo: number;
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
  deviceId?: string;
  shifts?: ShiftDashboardData[];
}


interface DashboardExportOptions {
  outlet: { name: string; branch: string };
  dayId: string;
  cashier: string;
  terminal: string;
  data: ShiftDashboardData;
  now?: Date;
}

export async function createDashboardWorkbook(options: DashboardExportOptions): Promise<ExcelJS.Workbook> {
  if (options.data.dayId !== options.dayId) throw new Error('Dashboard data does not match the selected date.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Dashboard');
  const { outlet } = options;
  const shifts = options.data.shifts?.length ? options.data.shifts : [options.data];
  const orderedShifts = [...shifts].sort((left, right) =>
    (left.startTime - right.startTime) || (left.shiftNo - right.shiftNo) || left.id.localeCompare(right.id));
  const firstShift = orderedShifts[0]!;
  const latestShift = orderedShifts.at(-1)!;
  const sum = (field: keyof ShiftDashboardData) => orderedShifts.reduce((total, shift) => {
    const value = shift[field];
    return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
  const payments = orderedShifts.reduce<Record<string, number>>((totals, shift) => {
    const shiftPayments = shift.payments ?? {};
    for (const [key, value] of Object.entries(shiftPayments)) {
      totals[key] = (totals[key] ?? 0) + (Number.isFinite(value) ? value : 0);
    }
    return totals;
  }, {});
  // Each payment category is summed across shifts; use the matching shift total when
  // older records omit that category from their payment breakdown.
  for (const [key, field] of [['cash', 'cashSale'], ['credit', 'creditSale']] as const) {
    payments[key] = orderedShifts.reduce((total, shift) => {
      const value = shift.payments?.[key];
      const fallback = shift[field];
      return total + (typeof value === 'number' && Number.isFinite(value)
        ? value : typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0);
    }, 0);
  }
  const data: ShiftDashboardData = {
    ...latestShift,
    dayId: options.data.dayId,
    shiftNo: 0,
    inActive: orderedShifts.every(shift => shift.inActive),
    startTime: firstShift.startTime,
    startBillNo: orderedShifts.find(shift => shift.startBillNo)?.startBillNo ?? '',
    lastBillNo: [...orderedShifts].reverse().find(shift => shift.lastBillNo)?.lastBillNo ?? '',
    openingAmt: firstShift.openingAmt,
    payments,
    ...Object.fromEntries([
      'billCount', 'billDeletesNumber', 'billDeletesAmount', 'totalSale', 'cashSale', 'digitalSale', 'creditSale',
      'subTotalBill', 'discount', 'tax', 'gstTotal', 'vatTotal', 'refundAmount', 'extraCharges',
      'serviceChargeAmount', 'roundOff', 'expensesAmtTotal', 'expCash', 'expDigital', 'advanceAmtTotal',
      'customerReceiveAmtTotal', 'receiveAmtTotal', 'swiggyTotal', 'zomatoTotal',
    ].map(field => [field, sum(field as keyof ShiftDashboardData)])),
  };
  const number = (value: number | undefined) => Number.isFinite(value) ? value! : 0;
  const moneyFormat = '#,##0.00;[Red]-#,##0.00';
  sheet.columns = [{ width: 38 }, { width: 34 }];
  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = outlet.name;
  sheet.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FF173B53' } };
  sheet.getCell('A1').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = outlet.name.length > 45 ? 60 : 36;
  sheet.mergeCells('A2:B2');
  sheet.getCell('A2').value = 'Retail POS Dashboard';
  sheet.getCell('A2').font = { size: 13, bold: true, color: { argb: 'FF60758A' } };
  sheet.getRow(2).height = 24;

  const detail = (label: string, value: string | number | Date, amount = false) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: 'FF40576C' } };
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE4EAF0' } } };
    });
    if (amount) row.getCell(2).numFmt = moneyFormat;
    else if (value instanceof Date) row.getCell(2).numFmt = 'dd mmm yyyy hh:mm:ss';
    else if (typeof value === 'number') row.getCell(2).numFmt = '#,##0';
    row.height = 23;
  };
  const section = (title: string) => {
    sheet.addRow([]);
    const row = sheet.addRow([title]);
    sheet.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF173B53' } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0F5' } };
    row.height = 26;
  };
  const timestamp = (value: number) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : '—';
  detail('Report Date', options.dayId);
  detail('Exported At', options.now ?? new Date());
  detail('Outlet', outlet.name);
  detail('Branch', outlet.branch || '—');
  detail('Terminal', options.terminal);
  detail('Cashier', options.cashier);
  detail('Scope', `All ${shifts.length} shift${shifts.length === 1 ? '' : 's'} for the selected date`);

  section('Key Sales Figures');
  detail('Cash In Hand', number(data.openingAmt) + number(data.cashSale) - number(data.expCash), true);
  detail('Total Sale', number(data.totalSale), true);
  detail('Total Digital Sale', number(data.digitalSale), true);

  section('Other Sales — Payment Methods');
  const paymentMethods: [string, string, number?][] = [
    ['cash', 'Cash', data.cashSale], ['googlepay', 'Google Pay'], ['phonepe', 'PhonePe'],
    ['paytm', 'Paytm'], ['cheque_payment_mode', 'Cheque'], ['card', 'Card'],
    ['credit', 'Credit', data.creditSale], ['other', 'Other'],
  ];
  for (const [key, label, fallback] of paymentMethods) detail(label, number(payments[key] ?? fallback), true);
  // Retain any additional payment modes returned by the dashboard service.
  for (const [key, value] of Object.entries(payments)) {
    if (!paymentMethods.some(([mode]) => mode === key)) detail(key, number(value), true);
  }

  section('Operational Summary');
  detail('No. of Bills', number(data.billCount));
  for (const [label, value] of [
    ['Subtotal', data.subTotalBill], ['Total Discount', data.discount], ['Opening Balance', data.openingAmt],
    ['Total Tax', data.tax], ['GST', data.gstTotal], ['VAT', data.vatTotal], ['Refund Amount', data.refundAmount],
    ['Extra Charge', data.extraCharges], ['Service Charge', data.serviceChargeAmount], ['Round Off', data.roundOff],
  ] as const) detail(label, number(value), true);
  detail('Deleted Bills', number(data.billDeletesNumber));
  detail('Deleted Bill Amount', number(data.billDeletesAmount), true);

  section('Expenses & Credits');
  for (const [label, value] of [
    ['Total Expenses', data.expensesAmtTotal], ['Cash Expenses', data.expCash], ['Digital Expenses', data.expDigital],
    ['Advance Payment', data.advanceAmtTotal], ['Received Customer Credit', data.customerReceiveAmtTotal],
    ['Total Received', data.receiveAmtTotal],
  ] as const) detail(label, number(value), true);

  section('Additional Sales');
  detail('Swiggy', number(data.swiggyTotal), true);
  detail('Zomato', number(data.zomatoTotal), true);

  section('All Shifts Summary');
  detail('Shifts Included', shifts.length);
  detail('Day Status', data.inActive ? 'All shifts closed' : 'At least one shift active');
  detail('First Shift Start', timestamp(firstShift.startTime));
  detail('Last Shift End', timestamp(latestShift.endTime));
  detail('First Bill No.', data.startBillNo || '—');
  detail('Last Bill No.', data.lastBillNo || '—');

  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  sheet.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return workbook;
}

export async function downloadDashboardExcel(options: DashboardExportOptions): Promise<void> {
  const workbook = await createDashboardWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const outletName = options.outlet.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Outlet';
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${outletName}_Dashboard_${options.dayId}.xlsx`;
    anchor.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
