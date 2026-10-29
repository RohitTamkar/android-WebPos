// Display snapshots only: every page still performs a fresh authenticated GET.
// No persistence, authorization decisions, stock calculations or write retries.
const snapshots = new Map<string, { url: string; value: unknown; expires: number }>();
let activeToken = '', revision = 0;
const MAX_ENTRIES = 32, TTL = 5 * 60_000;
const keyFor = (url: string, token: string) => JSON.stringify([token, url]);
export function masterSnapshotRevision() { return revision; }
export function clearMasterSnapshots() { snapshots.clear(); activeToken = ''; revision++; }
export function readMasterSnapshot<T>(url: string, token: string): T | undefined {
  if (activeToken !== token) { clearMasterSnapshots(); activeToken = token; }
  const entry = snapshots.get(keyFor(url, token));
  if (!entry) return;
  if (entry.expires <= Date.now()) { snapshots.delete(keyFor(url, token)); return; }
  return entry.value as T;
}
export function rememberMasterSnapshot(url: string, token: string, value: unknown, expectedRevision: number) {
  if (activeToken !== token || revision !== expectedRevision) return;
  const key = keyFor(url, token);
  snapshots.delete(key); snapshots.set(key, { url, value, expires: Date.now() + TTL });
  while (snapshots.size > MAX_ENTRIES) snapshots.delete(snapshots.keys().next().value!);
}
export function invalidateMasterSnapshots(url: string) {
  const prefix = /^\/api\/outlets\/[^/?]+\//.exec(url)?.[0];
  if (!prefix) return;
  revision++;
  for (const [key, entry] of snapshots) if (entry.url.startsWith(prefix)) snapshots.delete(key);
}
