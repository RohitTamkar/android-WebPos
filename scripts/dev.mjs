import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
let stopping = false;

function startNpm(args, name) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', error => {
    child.spawnError = error;
    console.error(`[${name}] Could not start: ${error.message}`);
    stopAll('SIGTERM');
  });
  return child;
}

function observeExit(child, name) {
  return new Promise(resolve => {
    child.once('error', error => resolve({ child, name, error }));
    child.once('exit', (code, signal) => resolve({ child, name, code, signal }));
  });
}

function stopAll(signal) {
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.once('SIGINT', () => stopAll('SIGINT'));
process.once('SIGTERM', () => stopAll('SIGTERM'));

const backend = startNpm(['run', 'dev', '--prefix', 'backend'], 'BACKEND');
const backendExit = observeExit(backend, 'BACKEND');
let backendReady = false;
const deadline = Date.now() + 30_000;

while (!backendReady && !stopping && Date.now() < deadline) {
  if (backend.exitCode !== null || backend.signalCode !== null || backend.spawnError) break;
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health', {
      signal: AbortSignal.timeout(1_000),
    });
    backendReady = response.ok;
  } catch {
    await delay(200);
  }
}

if (!backendReady) {
  const wasStopped = stopping;
  if (!wasStopped) console.error('[DEV] Backend did not become ready on port 3000 within 30 seconds.');
  stopAll('SIGTERM');
  if (!wasStopped) await backendExit;
  process.exitCode = wasStopped ? 130 : 1;
} else {
  console.log('[DEV] Backend is ready; starting the frontend.');
  const frontend = startNpm(['run', 'dev', '--prefix', 'frontend'], 'FRONTEND');
  const result = await Promise.race([backendExit, observeExit(frontend, 'FRONTEND')]);
  const wasStopped = stopping;
  stopAll('SIGTERM');
  process.exitCode = wasStopped ? 130 : typeof result.code === 'number' ? result.code : 1;
  if (result.name === 'BACKEND' && !wasStopped) console.error('[DEV] Backend exited; stopping the frontend.');
}
