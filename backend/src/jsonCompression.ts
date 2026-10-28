import { gzip } from 'node:zlib';
import type { RequestHandler } from 'express';

const MIN_BYTES = 16 * 1024;

// Gzip large JSON bodies (product lists reach several MB). Only res.json is
// affected; streamed files, images and Excel downloads are sent unchanged.
export function compressLargeJson(): RequestHandler {
  return (req, res, next) => {
    if (!/\bgzip\b/i.test(req.headers['accept-encoding'] ?? '')) { next(); return; }
    const sendJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const text = JSON.stringify(body);
      if (text === undefined || Buffer.byteLength(text) < MIN_BYTES || res.getHeader('Content-Encoding')) return sendJson(body);
      gzip(text, (error, compressed) => {
        if (res.headersSent) return;
        if (error) { sendJson(body); return; }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.vary('Accept-Encoding');
        res.end(compressed);
      });
      return res;
    };
    next();
  };
}
