// Receipt popups list only details a person needs, and only when they are set.
export const isProvided = (value: unknown) => typeof value === 'number' ? Number.isFinite(value)
  : typeof value === 'string' && !!value.trim() && value !== '—' && value !== 'Not provided';

// Android stores the table as JSON such as
// [{"table_no":"1","premise":"AC","premise_type":"Table",...}]. Show "AC · Table 1".
export function tableLabel(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return raw.trim(); }
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap(entry => {
    if (!entry || typeof entry !== 'object') return text(entry) ? [text(entry)] : [];
    const table = entry as Record<string, unknown>;
    const number = text(table.table_no);
    return [[text(table.premise), number && `${text(table.premise_type) || 'Table'} ${number}`].filter(Boolean).join(' · ')].filter(Boolean);
  }).join(', ');
}
