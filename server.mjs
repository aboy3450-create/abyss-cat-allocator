import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const allowed = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ...['app.js', 'core.js', 'db.js'].map(name => [`/${name}`, [name, 'text/javascript']]), ['/style.css', ['style.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
const port = Number(process.env.PORT || 4178);
createServer(async (request, response) => {
  const route = allowed.get(new URL(request.url, 'http://localhost').pathname);
  if (!route) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const content = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(500); response.end('Unable to read file'); }
}).listen(port, '127.0.0.1', () => console.log(`深淵貓本：http://127.0.0.1:${port}`));
