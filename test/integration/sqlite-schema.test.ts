import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '../../app/infra/db/sqlite.js';

describe('sqlite schema', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('creates all required tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-schema-'));
    tempDirs.push(dir);

    const db = initializeDatabase({ filePath: join(dir, 'claims.db') });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map((table) => table.name)).toEqual([
      'accumulator_entries',
      'claim_line_items',
      'claims',
      'disputes',
      'line_decisions',
      'members',
      'policies',
      'service_rules'
    ]);

    closeDatabase(db);
  });

  it('creates the expected foreign-key relationships', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-fk-'));
    tempDirs.push(dir);

    const db = initializeDatabase({ filePath: join(dir, 'claims.db') });

    const foreignKeys = (table: string): Array<{ table: string; from: string; to: string }> =>
      db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string; from: string; to: string }>;

    expect(foreignKeys('policies')).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'members', from: 'member_id', to: 'id' })])
    );
    expect(foreignKeys('service_rules')).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'policies', from: 'policy_id', to: 'id' })])
    );
    expect(foreignKeys('claims')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'members', from: 'member_id', to: 'id' }),
        expect.objectContaining({ table: 'policies', from: 'policy_id', to: 'id' })
      ])
    );
    expect(foreignKeys('claim_line_items')).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'claims', from: 'claim_id', to: 'id' })])
    );
    expect(foreignKeys('line_decisions')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'claim_line_items', from: 'claim_line_item_id', to: 'id' })
      ])
    );
    expect(foreignKeys('disputes')).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'claims', from: 'claim_id', to: 'id' })])
    );

    closeDatabase(db);
  });

  it('allows approved line decisions to omit reason details', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-columns-'));
    tempDirs.push(dir);

    const db = initializeDatabase({ filePath: join(dir, 'claims.db') });

    const columns = db.prepare('PRAGMA table_info(line_decisions)').all() as Array<{ name: string; notnull: number }>;

    expect(columns.find((column) => column.name === 'reason_code')).toEqual(
      expect.objectContaining({ name: 'reason_code', notnull: 0 })
    );
    expect(columns.find((column) => column.name === 'reason_text')).toEqual(
      expect.objectContaining({ name: 'reason_text', notnull: 0 })
    );

    closeDatabase(db);
  });
});
