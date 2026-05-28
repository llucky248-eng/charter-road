import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain',
};

/** Start a static file server. Returns the http.Server instance. */
export function startServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        let p = req.url.split('?')[0];
        if (p === '/' || p === '') p = '/index.html';
        const file = join(root, p);
        if (!existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
        const ext = extname(file);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(file));
      } catch { res.writeHead(500); res.end('Error'); }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}
