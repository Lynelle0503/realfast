import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiHandler, type ApiDependencies } from './api.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(CURRENT_DIR, '..', 'ui');

const STATIC_FILES = new Map<string, { contentType: string; body: string }>([
  ['/index.html', { contentType: 'text/html; charset=utf-8', body: readFileSync(resolve(UI_DIR, 'index.html'), 'utf8') }],
  ['/app.js', { contentType: 'text/javascript; charset=utf-8', body: readFileSync(resolve(UI_DIR, 'app.js'), 'utf8') }],
  ['/styles.css', { contentType: 'text/css; charset=utf-8', body: readFileSync(resolve(UI_DIR, 'styles.css'), 'utf8') }]
]);

function getStaticAsset(pathname: string): { contentType: string; body: string } | null {
  if (pathname === '/') {
    return STATIC_FILES.get('/index.html') ?? null;
  }

  return STATIC_FILES.get(pathname) ?? null;
}

export function createLocalAppServer(dependencies: ApiDependencies): Server {
  const apiHandler = createApiHandler(dependencies);

  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const asset = getStaticAsset(requestUrl.pathname);

    if (asset && request.method === 'GET') {
      response.statusCode = 200;
      response.setHeader('content-type', asset.contentType);
      response.end(asset.body);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      void apiHandler(request, response);
      return;
    }

    if (extname(requestUrl.pathname) === '') {
      const indexAsset = STATIC_FILES.get('/index.html');
      if (indexAsset) {
        response.statusCode = 200;
        response.setHeader('content-type', indexAsset.contentType);
        response.end(indexAsset.body);
        return;
      }
    }

    response.statusCode = 404;
    response.end();
  });
}
