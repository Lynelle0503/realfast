import { afterEach, describe, expect, it } from 'vitest';

import type { Server } from 'node:http';

import { createSqliteAppContext } from '../../app/infra/app/context.js';
import { seedDatabase } from '../../app/infra/db/seed.js';
import { createLocalAppServer } from '../../app/infra/http/local-app-server.js';
import { withSqliteDatabase } from './sqlite-test-helpers.js';

const createDb = withSqliteDatabase();

async function startServer(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server address was not available.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe('local ui server', () => {
  const servers: Server[] = [];
  const contexts: Array<{ close(): void }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await stopServer(server);
      }
    }

    while (contexts.length > 0) {
      contexts.pop()?.close();
    }
  });

  it('serves the demo ui shell, static assets, and the seeded api', async () => {
    const { filePath, close } = createDb();
    close();

    await seedDatabase({ filePath });

    const context = createSqliteAppContext({ filePath });
    contexts.push(context);

    const server = createLocalAppServer(context);
    servers.push(server);

    const baseUrl = await startServer(server);

    const htmlResponse = await fetch(`${baseUrl}/`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    const html = await htmlResponse.text();
    expect(html).toContain('Claims Demo UI');
    expect(html).toContain('member-list');
    expect(html).toContain('create-demo-member');

    const scriptResponse = await fetch(`${baseUrl}/app.js`);
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get('content-type')).toContain('text/javascript');
    const script = await scriptResponse.text();
    expect(script).toContain('loadMembers');
    expect(script).toContain('/api/v1/members');
    expect(script).toContain('/api/v1/policies/');
    expect(script).toContain('/api/v1/disputes/');

    const membersResponse = await fetch(`${baseUrl}/api/v1/members`);
    expect(membersResponse.status).toBe(200);
    await expect(membersResponse.json()).resolves.toEqual({
      items: [
        expect.objectContaining({ memberId: 'MEM-0001', fullName: 'Aarav Mehta' }),
        expect.objectContaining({ memberId: 'MEM-0002', fullName: 'Maya Rao' }),
        expect.objectContaining({ memberId: 'MEM-0003', fullName: 'Riya Shah' }),
        expect.objectContaining({ memberId: 'MEM-0004', fullName: 'Devika Nair' })
      ]
    });
  });
});
