// Standalone static file server for frontend (Zero dependencies required)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/login') {
    reqPath = '/login.html';
  }

  // Check in public/ directory first, then dist/
  let filePath = path.join(PUBLIC_DIR, reqPath);
  if (!fs.existsSync(filePath) && fs.existsSync(DIST_DIR)) {
    filePath = path.join(DIST_DIR, reqPath);
  }

  // Fallback to login.html if not found
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'login.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.code}`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` Web POS Frontend Server`);
  console.log(` Running at: http://localhost:${PORT}`);
  console.log(` Login Page: http://localhost:${PORT}/login.html`);
  console.log(`=========================================`);
});

