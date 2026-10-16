const totalFields = [
  'billCount', 'billDeletesNumber', 'billDeletesAmount', 'totalSale',
  'cashSale', 'digitalSale', 'creditSale', 'subTotalBill', 'discount',
  'tax', 'gstTotal', 'vatTotal', 'refundAmount', 'extraCharges',
  'serviceChargeAmount', 'roundOff', 'expensesAmtTotal', 'expCash',
  'expDigital', 'advanceAmtTotal', 'customerReceiveAmtTotal',
  'receiveAmtTotal', 'swiggyTotal', 'zomatoTotal',
] as const;

function amount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Shift opening balances can carry cash forward, so use only the first opening.
export function summarizeDay(shifts: Record<string, unknown>[]): Record<string, unknown> {
  const ordered = [...shifts].sort((left, right) => amount(left.shiftNo) - amount(right.shiftNo));
  const first = ordered[0] ?? {};
  const latest = ordered.at(-1) ?? {};
  const summary: Record<string, unknown> = {
    ...latest,
    openingAmt: amount(first.openingAmt),
    startTime: first.startTime,
    startBillNo: first.startBillNo,
  };
  for (const field of totalFields) {
    summary[field] = ordered.reduce((total, shift) => total + amount(shift[field]), 0);
  }

  const payments: Record<string, number> = {};
  for (const shift of ordered) {
    if (typeof shift.paymentJson !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(shift.paymentJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      for (const [mode, value] of Object.entries(parsed)) {
        payments[mode] = (payments[mode] ?? 0) + amount(value);
      }
    } catch {
      // Keep valid payment totals from the remaining shifts.
    }
  }
  summary.paymentJson = JSON.stringify(payments);
  return summary;
}
