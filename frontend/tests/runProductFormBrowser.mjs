// Runs the real React form in headless Chrome; every API request is mocked in the browser.
import { build } from '../../backend/node_modules/esbuild/lib/main.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'pos-product-form-'));
let server;
try {
  await build({ entryPoints: [resolve(testDirectory, process.argv[2] || 'addProductForm.browser.tsx')], bundle: true,
    outfile: join(temporary, 'ui.js'), format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><pre id="test-results">pending</pre><script src="/ui.js"></script></body></html>'); return; }
    if (req.url === '/ui.js' || req.url === '/ui.css') {
      res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(join(temporary, req.url.slice(1)))); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--window-size=${process.argv[3] || '1280,900'}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${join(temporary, 'chrome')}`,
    ...(process.argv[4] ? [`--screenshot=${process.argv[4]}`] : []), '--dump-dom', '--virtual-time-budget=12000', `http://127.0.0.1:${address.port}/${process.argv[4] ? '#preview' : ''}`]);
  let html = '', errors = '';
  chrome.stdout.on('data', chunk => { html += chunk; }); chrome.stderr.on('data', chunk => { errors += chunk; });
  const timer = setTimeout(() => chrome.kill(), 30000);
  const code = await new Promise(resolve => chrome.on('close', resolve)); clearTimeout(timer);
  const match = html.match(/<pre id="test-results"[^>]*>(.*?)<\/pre>/s);
  const output = match?.[1]?.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  if (code !== 0 || !output || output === 'pending') throw new Error(`Browser checks did not complete: ${errors.slice(-1500)}`);
  const result = JSON.parse(output);
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
