function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function reportDateError(startDate: string, endDate: string): string {
  if (!validDate(startDate) || !validDate(endDate)) return 'Choose valid start and end dates.';
  if (startDate > endDate) return 'Start date must be before the end date.';
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  return days > 31 ? 'Date range cannot exceed 31 days.' : '';
}
