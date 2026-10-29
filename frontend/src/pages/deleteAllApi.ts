export class DeleteAllError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// Calls the confirmed Delete All endpoint for one outlet master collection.
const CONFIRMATIONS = { products: 'DELETE_ALL_PRODUCTS', categories: 'DELETE_ALL_CATEGORIES',
  employees: 'DELETE_ALL_EMPLOYEES', customers: 'DELETE_ALL_CUSTOMERS', premises: 'DELETE_ALL_PREMISES',
  'service-points': 'DELETE_ALL_SERVICE_POINTS' } as const;

export async function deleteAllRecords(outletId: string, token: string, route: keyof typeof CONFIRMATIONS) {
  const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/${route}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: CONFIRMATIONS[route] }),
  });
  let result: { success?: boolean; message?: string; data?: { deleted?: number } } | null = null;
  try { result = await response.json(); } catch { result = null; }
  if (response.status === 401) throw new DeleteAllError('Your session has expired. Please sign in again.', 401);
  if (!response.ok || result?.success !== true) throw new DeleteAllError(result?.message || `Unable to delete all ${route.replace('-', ' ')}. Please try again.`, response.status);
  return result.data?.deleted ?? 0;
}
