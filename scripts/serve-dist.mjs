// A tiny static server for dist/, used by the browser tests. It serves the build from a folder address so
// the tests also prove that nothing in the build depends on the site root.
import {createServer} from 'node:http';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};
/** Serves dist/ at http://127.0.0.1:<free port><folder>. Returns the address and a function that stops it. */
export async function serveDist(folder = '/') {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing. Run npm run build first.');
  const server = createServer((request, response) => {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    } catch {
      response.writeHead(400).end('bad request');
      return;
    }
    const inside = path.startsWith(folder) ? normalize(path.slice(folder.length) || 'index.html') : null;
    const file = inside && !inside.startsWith('..') ? join(dist, inside) : null;
    if (!file || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'});
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}${folder}`, close: () => server.close()};
}
