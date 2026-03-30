import type Database from 'better-sqlite3';

import type { AccumulatorEntry } from '../../../core/domain/accumulator.js';
import type { AccumulatorRepository } from '../../../core/ports/repositories.js';
import { mapAccumulatorRow } from '../mappers/accumulator-row-mapper.js';

interface AccumulatorRow {
  member_id: string;
  policy_id: string;
  service_code: string;
  benefit_period_start: string;
  benefit_period_end: string;
  metric_type: 'dollars_paid' | 'visits_used' | 'member_oop_applied';
  delta: number;
  source: 'claim_line_item';
  source_id: string;
  status: 'posted' | 'reversed';
}

export class SqliteAccumulatorRepository implements AccumulatorRepository {
  constructor(private readonly db: Database.Database) {}

  async append(entry: AccumulatorEntry): Promise<void> {
    this.insertEntries([entry]);
  }

  async appendMany(entries: AccumulatorEntry[]): Promise<void> {
    this.insertEntries(entries);
  }

  async listByPolicy(policyId: string): Promise<AccumulatorEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT
           member_id,
           policy_id,
           service_code,
           benefit_period_start,
           benefit_period_end,
           metric_type,
           delta,
           source,
           source_id,
           status
         FROM accumulator_entries
         WHERE policy_id = ?
         ORDER BY id`
      )
      .all(policyId) as AccumulatorRow[];

    return rows.map(mapAccumulatorRow);
  }

  async listByPolicyAndService(policyId: string, serviceCode: string): Promise<AccumulatorEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT
           member_id,
           policy_id,
           service_code,
           benefit_period_start,
           benefit_period_end,
           metric_type,
           delta,
           source,
           source_id,
           status
         FROM accumulator_entries
         WHERE policy_id = ? AND service_code = ?
         ORDER BY id`
      )
      .all(policyId, serviceCode) as AccumulatorRow[];

    return rows.map(mapAccumulatorRow);
  }

  private insertEntries(entries: AccumulatorEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    const transaction = this.db.transaction((values: AccumulatorEntry[]) => {
      const insertStatement = this.db.prepare(
        `INSERT INTO accumulator_entries (
           id,
           member_id,
           policy_id,
           service_code,
           benefit_period_start,
           benefit_period_end,
           metric_type,
           delta,
           source,
           source_id,
           status
         ) VALUES (
           @id,
           @member_id,
           @policy_id,
           @service_code,
           @benefit_period_start,
           @benefit_period_end,
           @metric_type,
           @delta,
           @source,
           @source_id,
           @status
         )`
      );

      values.forEach((entry, index) => {
        insertStatement.run({
          id: `${entry.policyId}-${entry.serviceCode}-${entry.metricType}-${String(index + 1).padStart(4, '0')}-${entry.sourceId}`,
          member_id: entry.memberId,
          policy_id: entry.policyId,
          service_code: entry.serviceCode,
          benefit_period_start: entry.benefitPeriodStart,
          benefit_period_end: entry.benefitPeriodEnd,
          metric_type: entry.metricType,
          delta: entry.delta,
          source: entry.source,
          source_id: entry.sourceId,
          status: entry.status
        });
      });
    });

    transaction(entries);
  }
}
