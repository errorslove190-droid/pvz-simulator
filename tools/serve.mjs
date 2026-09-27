#!/usr/bin/env node
// Локальный сервер для разработки: отдаёт src/ (или собранный dist/) и имитацию SDK Яндекс Игр по /sdk.js.
//
//   node tools/serve.mjs                   → http://localhost:8080 (исходники, с имитацией SDK)
//   node tools/serve.mjs --root dist       → проверить собранный файл
//   node tools/serve.mjs --no-sdk          → как при локальном запуске без платформы (sdk.js отдаёт 404)
//   node tools/serve.mjs --port 8801
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', 8080));
const root = resolve(arg('--root', 'src'));
const noSdk = process.argv.includes('--no-sdk');
const mock = fileURLToPath(new URL('./sdk-mock.js', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (path === '/sdk.js') {
    if (noSdk) { res.writeHead(404).end(); return; }
    file = mock;
  } else {
    file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}  (${root}${noSdk ? ', без SDK' : ', имитация SDK Яндекс Игр'})`);
});
