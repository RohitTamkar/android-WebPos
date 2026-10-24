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
    plugins: process.env.WEB_USAGE_TEST_ENABLED === '1' ? [{ name: 'enable-retained-usage-for-tests', setup(build) {
      build.onLoad({ filter: /[\\/]shared[\\/]webUsageFeature\.ts$/ }, () => ({ contents: 'export const DAILY_WEB_USAGE_ENABLED = true;', loader: 'ts' }));
    } }] : [],
    outfile: join(temporary, 'ui.js'), format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
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
  const realtime = process.env.BROWSER_TEST_REALTIME === '1';
  const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--window-size=${process.argv[3] || '1280,900'}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${join(temporary, 'chrome')}`,
    ...(!realtime && process.argv[4] ? [`--screenshot=${process.argv[4]}`] : []), ...(realtime ? ['--remote-debugging-port=0'] : ['--dump-dom', '--virtual-time-budget=12000']), `http://127.0.0.1:${address.port}/${process.argv[4] ? '#preview' : ''}`]);
  const closed = new Promise(resolve => chrome.on('close', resolve));
  let html = '', errors = '';
  chrome.stdout.on('data', chunk => { html += chunk; }); chrome.stderr.on('data', chunk => { errors += chunk; });
  const timer = setTimeout(() => chrome.kill(), 30000);
  let code;
  if (realtime) {
    let socket;
    try {
      let port;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { port = (await readFile(join(temporary, 'chrome', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 50)); }
      }
      if (!port) throw new Error('Chrome debugging port did not become available');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(target => target.type === 'page');
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      let requestId = 0;
      const evaluate = expression => new Promise((resolve, reject) => {
        const id = ++requestId;
        const listener = event => {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          socket.removeEventListener('message', listener);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result.result.value);
        };
        socket.addEventListener('message', listener);
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
      });
      for (let attempt = 0; attempt < 250; attempt++) {
        const result = await evaluate('document.getElementById("test-results")?.textContent');
        if (result && result !== 'pending') { html = await evaluate('document.documentElement.outerHTML'); break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (process.argv[4]) {
        const screenshot = await new Promise(resolve => {
          const id = ++requestId;
          socket.addEventListener('message', function receive(event) {
            const message = JSON.parse(event.data);
            if (message.id === id) { socket.removeEventListener('message', receive); resolve(message.result.data); }
          });
          socket.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
        });
        const { writeFile } = await import('node:fs/promises');
        await writeFile(process.argv[4], Buffer.from(screenshot, 'base64'));
      }
      code = 0;
    } finally { socket?.close(); chrome.kill(); await closed; clearTimeout(timer); }
  } else { code = await closed; clearTimeout(timer); }
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
