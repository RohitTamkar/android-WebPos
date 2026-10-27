// Match Firestore's auto-ID format without a database connection.
export function createFirestoreDocumentId(crypto: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(40))) {
      // Rejection sampling keeps all 62 characters equally likely.
      if (byte < 248) id += alphabet[byte % alphabet.length];
      if (id.length === 20) return id;
    }
  }
  return id;
}

// randomUUID requires a secure context; getRandomValues also works over LAN HTTP.
export function createRequestId(crypto: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
