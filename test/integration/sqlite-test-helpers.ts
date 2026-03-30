import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach } from 'vitest';

import { closeDatabase, initializeDatabase } from '../../src/infra/db/sqlite.js';

export function withSqliteDatabase() {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  return () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-sqlite-'));
    tempDirs.push(dir);

    const db = initializeDatabase({ filePath: join(dir, 'claims.db') });
    return {
      db,
      close: () => closeDatabase(db),
      filePath: join(dir, 'claims.db')
    };
  };
}
