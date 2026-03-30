import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { seedDatabase } from '../../app/infra/db/seed.js';
import { closeDatabase, openDatabase } from '../../app/infra/db/sqlite.js';

describe('sqlite seed', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('creates the expected seeded dataset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-seed-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'claims.db');

    const summary = await seedDatabase({ filePath });
    expect(summary).toEqual({
      filePath,
      members: 4,
      policies: 5,
      claims: 3,
      disputes: 1,
      accumulatorEntries: 18
    });

    const db = openDatabase({ filePath });

    const claimStatuses = db
      .prepare('SELECT id, status FROM claims ORDER BY id')
      .all() as Array<{ id: string; status: string }>;

    expect(claimStatuses.map((row) => row.status)).toEqual(['under_review', 'approved', 'paid']);

    const disputes = db.prepare('SELECT claim_id FROM disputes ORDER BY id').all() as Array<{ claim_id: string }>;
    expect(disputes).toHaveLength(1);

    const duplicateMemberPolicies = db
      .prepare(
        `SELECT member_id, policy_id, COUNT(*) AS claim_count
         FROM claims
         GROUP BY member_id, policy_id
         HAVING COUNT(*) > 1`
      )
      .all() as Array<{ member_id: string; policy_id: string; claim_count: number }>;

    expect(duplicateMemberPolicies).toEqual([]);

    const membersWithoutPolicies = db
      .prepare(
        `SELECT members.id
         FROM members
         LEFT JOIN policies ON policies.member_id = members.id
         GROUP BY members.id
         HAVING COUNT(policies.id) = 0`
      )
      .all() as Array<{ id: string }>;

    expect(membersWithoutPolicies).toEqual([]);

    const memberPolicyCounts = db
      .prepare(
        `SELECT member_id, COUNT(*) AS policy_count
         FROM policies
         GROUP BY member_id
         ORDER BY member_id`
      )
      .all() as Array<{ member_id: string; policy_count: number }>;

    expect(memberPolicyCounts).toEqual([
      { member_id: 'MEM-0001', policy_count: 2 },
      { member_id: 'MEM-0002', policy_count: 1 },
      { member_id: 'MEM-0003', policy_count: 1 },
      { member_id: 'MEM-0004', policy_count: 1 }
    ]);

    closeDatabase(db);
  });
});
