import type { PremisesRecord, PremisesTransactionRunner, TypedFields } from './premises.js';

interface Value {
  stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean;
  timestampValue?: string; nullValue?: unknown; arrayValue?: { values?: Value[] };
  mapValue?: { fields?: Record<string, Value> };
}
interface Document { name: string; fields?: Record<string, Value> }
function decode(value: Value): unknown {
  if ('nullValue' in value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decode);
  if ('mapValue' in value) return fields(value.mapValue?.fields);
  return value.stringValue ?? value.timestampValue;
}
const fields = (input?: Record<string, Value>) => Object.fromEntries(Object.entries(input ?? {}).map(([key, value]) => [key, decode(value)]));

// The public REST API accepts explicit Value types. The Admin SDK's numeric
// serializer would otherwise store an integral price (including 0) as int64.
export function premisesTransactionRunner(database: string, accessToken: () => Promise<string>,
  fetcher: typeof fetch = fetch): PremisesTransactionRunner {
  if (!/^projects\/[^/]+\/databases\/[^/]+$/.test(database)) throw new Error('Invalid Firestore database.');
  const documents = `${database}/documents`;
  return async work => {
    const token = await accessToken();
    async function call(path: string, body?: unknown, missing = false): Promise<any> {
      const response = await fetcher(`https://firestore.googleapis.com/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
      });
      if (missing && response.status === 404) return undefined;
      if (!response.ok) {
        const result = await response.json() as { error?: { status?: string } };
        throw Object.assign(new Error('Firestore premises transaction failed.'), { status: result.error?.status });
      }
      return response.json();
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { transaction } = await call(`${documents}:beginTransaction`, { options: { readWrite: {} } }) as { transaction: string };
      const writes: { update: { name: string; fields: TypedFields }; currentDocument: { exists: boolean }; updateMask?: { fieldPaths: string[] } }[] = [];
      try {
        const result = await work({
          read: async path => {
            const document = await call(`${documents}/${path.split('/').map(encodeURIComponent).join('/')}?transaction=${encodeURIComponent(transaction)}`, undefined, true) as Document | undefined;
            return document ? fields(document.fields) : undefined;
          },
          list: async path => {
            const parts = path.split('/'); const collectionId = parts.pop()!;
            const parent = parts.length ? `/${parts.map(encodeURIComponent).join('/')}` : '';
            const rows = await call(`${documents}${parent}:runQuery`, {
              structuredQuery: { from: [{ collectionId }] }, transaction,
            }) as { document?: Document }[];
            return rows.flatMap(({ document }): PremisesRecord[] => document
              ? [{ documentId: document.name.split('/').at(-1)!, fields: fields(document.fields) }] : []);
          },
          create: (path, values) => writes.push({ update: { name: `${documents}/${path}`, fields: values }, currentDocument: { exists: false } }),
          update: (path, values) => writes.push({ update: { name: `${documents}/${path}`, fields: values },
            updateMask: { fieldPaths: Object.keys(values) }, currentDocument: { exists: true } }),
        });
        await call(`${documents}:commit`, { transaction, writes });
        return result;
      } catch (error) {
        await call(`${documents}:rollback`, { transaction }).catch(() => undefined);
        if ((error as { status?: string }).status === 'ABORTED' && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error('Unable to commit premises.');
  };
}
