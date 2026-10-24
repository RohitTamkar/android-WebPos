const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const withoutPrice = (name: string) => name.replace(/\s+price$/i, '').trim();

// Android uses keys such as "TABLE price" inside the existing priceTable string.
// Match those to the configured premise without rewriting any stored keys/values.
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
    const identity = rows.has(normalized) ? normalized : normalize(base);
    let row = rows.get(identity);
    if (!row) {
      row = { name: base || key.trim(), price: undefined, priority: 0 };
      rows.set(identity, row);
    }
    // Prefer the Android price key if both it and an older plain-name key exist.
    const priority = normalized === `${normalize(row.name)} price` ? 2 : 1;
    if (priority > row.priority) { row.price = price; row.priority = priority; }
  }
  return [...rows.values()].map(({ name, price }) => ({
    name, label: /\bprice$/i.test(name) ? name : `${name} Price`, price,
  }));
}
