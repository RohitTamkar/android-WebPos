export type ProductSort = 'code' | 'name' | 'date' | 'regional';
export const PRODUCT_SORTS: { value: ProductSort; label: string }[] = [
  { value: 'code', label: 'Search Code' },
  { value: 'name', label: 'Sort A-Z' },
  { value: 'date', label: 'Sort By Date' },
  { value: 'regional', label: 'Regional Wise' },
];
export const isProductSort = (value: unknown): value is ProductSort => PRODUCT_SORTS.some(sort => sort.value === value);

const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const compareText = (left: string, right: string) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });

// dateTme is a Firestore Timestamp: JSON from the API gives {_seconds}/{seconds}; Android may store millis or ISO text.
export function productDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) { const time = Date.parse(value); return Number.isNaN(time) ? null : time; }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const seconds = record._seconds ?? record.seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

// Blank names/dates sort last; ties fall back to Search Code so the order is stable.
export function sortProducts<T extends { fields: Record<string, unknown> }>(products: T[], sort: ProductSort): T[] {
  const byCode = (left: T, right: T) => compareText(text(left.fields.code), text(right.fields.code));
  const blankLast = (left: string, right: string) => !left !== !right ? (left ? -1 : 1) : compareText(left, right);
  return [...products].sort((left, right) => {
    let result = 0;
    if (sort === 'name') result = blankLast(text(left.fields.name), text(right.fields.name));
    else if (sort === 'regional') result = blankLast(text(left.fields.regionalName), text(right.fields.regionalName));
    else if (sort === 'date') {
      const a = productDate(left.fields.dateTme), b = productDate(right.fields.dateTme);
      result = a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : b - a;
    }
    return result || byCode(left, right);
  });
}
