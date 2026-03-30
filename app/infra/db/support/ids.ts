import type Database from 'better-sqlite3';

import type { IdGenerator } from '../../../core/ports/repositories.js';

export class DeterministicIdGenerator implements IdGenerator {
  constructor(initialCounters?: Record<string, number>) {
    if (initialCounters) {
      Object.entries(initialCounters).forEach(([prefix, value]) => {
        this.counters.set(prefix, value);
      });
    }
  }

  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const nextValue = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, nextValue);
    return `${prefix}-${String(nextValue).padStart(4, '0')}`;
  }
}

function readExistingIds(db: Database.Database, tableName: string): string[] {
  const rows = db.prepare(`SELECT id FROM ${tableName}`).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function getMaxSuffix(ids: string[], prefix: string): number {
  return ids.reduce((maxValue, id) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (!match) {
      return maxValue;
    }

    return Math.max(maxValue, Number(match[1]));
  }, 0);
}

export function createDatabaseAwareIdGenerator(db: Database.Database): IdGenerator {
  return new DeterministicIdGenerator({
    MEM: getMaxSuffix(readExistingIds(db, 'members'), 'MEM'),
    POL: getMaxSuffix(readExistingIds(db, 'policies'), 'POL'),
    CLM: getMaxSuffix(readExistingIds(db, 'claims'), 'CLM'),
    LI: getMaxSuffix(readExistingIds(db, 'claim_line_items'), 'LI'),
    DSP: getMaxSuffix(readExistingIds(db, 'disputes'), 'DSP')
  });
}
