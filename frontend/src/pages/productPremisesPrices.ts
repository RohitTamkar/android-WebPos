const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const withoutPrice = (name: string) => name.replace(/\s+price$/i, '').trim();

export function productPremisesPriceKey(name: string, table: Record<string, unknown>): string {
  const keys = Object.keys(table);
  return keys.find(key => normalize(key) === `${normalize(name)} price`)
    ?? keys.find(key => normalize(key) === normalize(name))
    ?? (/\bprice$/i.test(name) ? name : `${name} price`);
}

// Android uses keys such as "TABLE price" inside the existing priceTable string.
// Match those to the configured premise without rewriting any stored keys/values.
// Only the outlet's current premises are listed: prices saved for a deleted
// premise stay stored but are not shown.
export function productPremisesPrices(premises: { name: string }[], priceTable: Record<string, unknown>) {
  const rows = new Map<string, { name: string; price: unknown; priority: number }>();
  for (const premise of premises) {
    const name = premise.name.trim().replace(/\s+/g, ' ');
    if (name && !rows.has(normalize(name))) rows.set(normalize(name), { name, price: undefined, priority: 0 });
  }
  for (const [key, price] of Object.entries(priceTable)) {
    const normalized = normalize(key);
    if (!normalized || normalized === 'default price') continue;
    const base = withoutPrice(key.trim().replace(/\s+/g, ' '));
    const row = rows.get(rows.has(normalized) ? normalized : normalize(base));
    if (!row) continue;
    // Prefer the Android price key if both it and an older plain-name key exist.
    const priority = normalized === `${normalize(row.name)} price` ? 2 : 1;
    if (priority > row.priority) { row.price = price; row.priority = priority; }
  }
  return [...rows.values()].map(({ name, price }) => ({
    name, label: /\bprice$/i.test(name) ? name : `${name} Price`, price,
  }));
}
