// Tiny static server for testing on this PC: node dev-server.mjs  → http://localhost:8080
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[\\/]+/, '');
  if (!p || /[\\/]$/.test(p)) p += 'index.html';
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(process.env.PORT || 8080, () => console.log('Fairway Book on http://localhost:' + (process.env.PORT || 8080)));
