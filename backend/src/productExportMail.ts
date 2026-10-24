import { ProductCreationError } from './productCreation.js';

export interface ProductMailAttachment { buffer: Buffer; filename: string }
// No credentials or workbook data are supplied by the browser. Uses the provider's
// attachment API: https://resend.com/docs/api-reference/emails/send-email
export async function sendProductExportEmail(email: string, attachment: ProductMailAttachment,
  config = { apiKey: process.env.RESEND_API_KEY, from: process.env.PRODUCT_EXPORT_EMAIL_FROM }, request: typeof fetch = fetch) {
  if (!config.apiKey?.trim() || !config.from?.trim()) throw new ProductCreationError(503,
    'Product email delivery is not configured. Ask your administrator to configure the mail service.');
  const content = attachment.buffer.toString('base64');
  if (content.length > 35 * 1024 * 1024) throw new ProductCreationError(422, 'This workbook is too large to email. Use Download instead.');
  let response: Response;
  try {
    response = await request('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [email], subject: 'Sensible Biz POS — Products',
        text: 'The complete product workbook for your outlet is attached.',
        attachments: [{ filename: attachment.filename, content }] }),
    });
  } catch {
    throw new ProductCreationError(502, 'The mail service did not confirm sending. Check the recipient inbox before trying again.');
  }
  const result = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!response.ok || typeof result?.id !== 'string' || !result.id.trim()) throw new ProductCreationError(502,
    'The mail service did not accept the email. Please check the address or contact your administrator.');
  return result.id;
}
