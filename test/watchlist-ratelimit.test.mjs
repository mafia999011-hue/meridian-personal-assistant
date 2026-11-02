import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, cp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root, port, child;
const baseHeaders = () => ({ Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' });

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port: available } = server.address();
  await new Promise(resolve => server.close(resolve));
  return available;
}
async function request(pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, { ...options, headers: { ...baseHeaders(), ...(options.headers || {}) } });
}

function rawRequest(pathname, { method = 'GET', host, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (host) headers.Host = host;
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited during startup (${child.exitCode}).`);
    try { const response = await request('/api/watchlist'); if (response.ok) return; }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start within 10 seconds.');
}

test.before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'meridian-test-'));
  await cp(repo, root, { recursive: true, filter: source => !['.git', 'data', '.env', 'node_modules'].includes(path.basename(source)) });
  await mkdir(path.join(root, 'data'), { recursive: true });
  port = await freePort();
  await writeFile(path.join(root, '.env'), `PORT=${port}\nAI_PROVIDER=ollama\n`);
  const env = { PATH: process.env.PATH || '', PORT: String(port), AI_PROVIDER: 'ollama' };
  for (const key of ['LD_LIBRARY_PATH', 'PREFIX', 'HOME', 'TMPDIR', 'ANDROID_ROOT', 'ANDROID_DATA']) if (process.env[key]) env[key] = process.env[key];
  child = spawn(process.execPath, ['--env-file=.env', 'server.mjs'], { cwd: root, env, stdio: 'ignore' });
  await waitForServer();
});

test.after(async () => {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); }
  if (root) await rm(root, { recursive: true, force: true });
});

test('manual watch checks share one rate limit across watch IDs', async () => {
  const create = async query => {
    const response = await request('/api/watchlist', { method: 'POST', body: JSON.stringify({ kind: 'news', query }) });
    assert.equal(response.status, 201);
    return (await response.json()).id;
  };
  const firstId = await create(`test-one-${Date.now()}`);
  const secondId = await create(`test-two-${Date.now()}`);
  try {
    for (let count = 0; count < 5; count += 1) {
      const response = await request(`/api/watchlist/${firstId}/check`, { method: 'POST', body: '{}' });
      assert.equal(response.status, 200, `same-watch request ${count + 1} should remain within the limit`);
    }
    const response = await request(`/api/watchlist/${secondId}/check`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 429, 'the sixth manual check in a minute should be blocked across watch IDs');
  } finally {
    await request(`/api/watchlist/${firstId}`, { method: 'DELETE' });
    await request(`/api/watchlist/${secondId}`, { method: 'DELETE' });
  }
});


test('watchlist hides and prunes alerts older than 30 days', async () => {
  const response = await request('/api/watchlist', { method: 'POST', body: JSON.stringify({ kind: 'news', query: `retention-${Date.now()}` }) });
  assert.equal(response.status, 201);
  const watchId = (await response.json()).id;
  const database = new DatabaseSync(path.join(root, 'data', 'meridian.sqlite3'));
  try {
    database.prepare('INSERT INTO watch_events(watch_id,summary,url,created) VALUES(?,?,?,?)').run(watchId, 'Old test event', null, Date.now() - 31 * 24 * 60 * 60 * 1000);
    const listed = await request('/api/watchlist');
    const data = await listed.json();
    assert.equal(data.alerts.some(alert => alert.summary === 'Old test event'), false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM watch_events WHERE watch_id=?').get(watchId).count, 0);
  } finally {
    database.close();
    await request(`/api/watchlist/${watchId}`, { method: 'DELETE' });
  }
});


test('dashboard is open directly and old login route is gone', async () => {
  const dashboard = await request('/');
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Situation Room/);
  const login = await request('/login');
  assert.equal(login.status, 404);
});

test('Quick Tunnel hostnames pass while unrelated hosts remain blocked', async () => {
  const tunnel = await rawRequest('/api/watchlist', { host: 'new-name.trycloudflare.com', origin: 'https://new-name.trycloudflare.com' });
  assert.equal(tunnel.status, 200);
  const unrelated = await rawRequest('/api/watchlist', { host: 'unrelated.example', origin: 'https://unrelated.example' });
  assert.equal(unrelated.status, 403);
});

test('provider diagnostics report missing keys without contacting providers', async () => {
  for (const provider of ['aviationstack', 'mediastack']) {
    const response = await request('/api/providers/check', { method: 'POST', body: JSON.stringify({ provider }) });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, false);
    assert.match(data.message, /No .* key is configured/);
  }
});


test('Quick Tunnel launcher passes the allowed email to cloudflared', async () => {
  const fakeBin = path.join(root, 'fake-bin');
  await mkdir(fakeBin, { recursive: true });
  const fakeCloudflared = path.join(fakeBin, 'cloudflared');
  await writeFile(fakeCloudflared, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  await chmod(fakeCloudflared, 0o755);
  const email = 'allowed@example.com';
  const output = await new Promise((resolve, reject) => {
    const launcher = spawn('sh', ['scripts/start-cloudflare-quick-tunnel.sh', email], {
      cwd: root, env: { PATH: `${fakeBin}:${process.env.PATH || ''}`, PORT: '4173' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    launcher.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    launcher.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    launcher.on('error', reject);
    launcher.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`launcher failed (${code}): ${stderr}`)));
  });
  assert.match(output, /--allowed-mail/);
  assert.match(output, /allowed@example\.com/);
  assert.match(output, /http:\/\/127\.0\.0\.1:4173/);
});
