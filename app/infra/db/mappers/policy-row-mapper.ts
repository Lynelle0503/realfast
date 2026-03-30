import type { Policy, ServiceRule } from '../../../core/domain/policy.js';

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

function mapServiceRuleRow(row: ServiceRuleRow): ServiceRule {
  return {
    serviceCode: row.service_code,
    covered: Boolean(row.covered),
    yearlyDollarCap: row.yearly_dollar_cap,
    yearlyVisitCap: row.yearly_visit_cap
  };
}

export function mapPolicyRow(row: PolicyRow, serviceRuleRows: ServiceRuleRow[]): Policy {
  return {
    policyId: row.id,
    memberId: row.member_id,
    policyType: row.policy_type,
    effectiveDate: row.effective_date,
    coverageRules: {
      benefitPeriod: row.benefit_period,
      deductible: row.deductible,
      coinsurancePercent: row.coinsurance_percent,
      annualOutOfPocketMax: row.annual_out_of_pocket_max,
      serviceRules: serviceRuleRows.map(mapServiceRuleRow)
    }
  };
}
