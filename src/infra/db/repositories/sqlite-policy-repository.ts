import type Database from 'better-sqlite3';

import type { Policy } from '../../../core/domain/policy.js';
import type { PolicyRepository } from '../../../core/ports/repositories.js';
import { mapPolicyRow } from '../mappers/policy-row-mapper.js';

interface PolicyRow {
  id: string;
  member_id: string;
  policy_type: string;
  effective_date: string;
  benefit_period: 'policy_year';
  deductible: number;
  coinsurance_percent: number;
  annual_out_of_pocket_max: number;
}

interface ServiceRuleRow {
  service_code: string;
  covered: number;
  yearly_dollar_cap: number | null;
  yearly_visit_cap: number | null;
}

export class SqlitePolicyRepository implements PolicyRepository {
  constructor(private readonly db: Database.Database) {}

  async create(policy: Policy): Promise<void> {
    const transaction = this.db.transaction((value: Policy) => {
      this.db
        .prepare(
          `INSERT INTO policies (
             id,
             member_id,
             policy_type,
             effective_date,
             benefit_period,
             deductible,
             coinsurance_percent,
             annual_out_of_pocket_max
           ) VALUES (
             @id,
             @member_id,
             @policy_type,
             @effective_date,
             @benefit_period,
             @deductible,
             @coinsurance_percent,
             @annual_out_of_pocket_max
           )`
        )
        .run({
          id: value.policyId,
          member_id: value.memberId,
          policy_type: value.policyType,
          effective_date: value.effectiveDate,
          benefit_period: value.coverageRules.benefitPeriod,
          deductible: value.coverageRules.deductible,
          coinsurance_percent: value.coverageRules.coinsurancePercent,
          annual_out_of_pocket_max: value.coverageRules.annualOutOfPocketMax
        });

      const insertServiceRule = this.db.prepare(
        `INSERT INTO service_rules (
           id,
           policy_id,
           service_code,
           covered,
           yearly_dollar_cap,
           yearly_visit_cap
         ) VALUES (
           @id,
           @policy_id,
           @service_code,
           @covered,
           @yearly_dollar_cap,
           @yearly_visit_cap
         )`
      );

      value.coverageRules.serviceRules.forEach((serviceRule, index) => {
        insertServiceRule.run({
          id: `${value.policyId}-SR-${String(index + 1).padStart(4, '0')}`,
          policy_id: value.policyId,
          service_code: serviceRule.serviceCode,
          covered: serviceRule.covered ? 1 : 0,
          yearly_dollar_cap: serviceRule.yearlyDollarCap,
          yearly_visit_cap: serviceRule.yearlyVisitCap
        });
      });
    });

    transaction(policy);
  }

  async getById(policyId: string): Promise<Policy | null> {
    const row = this.db
      .prepare(
        `SELECT
           id,
           member_id,
           policy_type,
           effective_date,
           benefit_period,
           deductible,
           coinsurance_percent,
           annual_out_of_pocket_max
         FROM policies
         WHERE id = ?`
      )
      .get(policyId) as PolicyRow | undefined;

    if (!row) {
      return null;
    }

    return mapPolicyRow(row, this.getServiceRuleRows(policyId));
  }

  async listByMemberId(memberId: string): Promise<Policy[]> {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           member_id,
           policy_type,
           effective_date,
           benefit_period,
           deductible,
           coinsurance_percent,
           annual_out_of_pocket_max
         FROM policies
         WHERE member_id = ?
         ORDER BY id`
      )
      .all(memberId) as PolicyRow[];

    return rows.map((row) => mapPolicyRow(row, this.getServiceRuleRows(row.id)));
  }

  private getServiceRuleRows(policyId: string): ServiceRuleRow[] {
    return this.db
      .prepare(
        `SELECT service_code, covered, yearly_dollar_cap, yearly_visit_cap
         FROM service_rules
         WHERE policy_id = ?
         ORDER BY id`
      )
      .all(policyId) as ServiceRuleRow[];
  }
}
