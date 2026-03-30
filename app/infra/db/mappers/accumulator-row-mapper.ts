import type { AccumulatorEntry } from '../../../core/domain/accumulator.js';
import type { AccumulatorEntryStatus, AccumulatorMetricType } from '../../../core/domain/enums.js';

interface AccumulatorEntryRow {
  member_id: string;
  policy_id: string;
  service_code: string;
  benefit_period_start: string;
  benefit_period_end: string;
  metric_type: AccumulatorMetricType;
  delta: number;
  source: 'claim_line_item';
  source_id: string;
  status: AccumulatorEntryStatus;
}

export function mapAccumulatorRow(row: AccumulatorEntryRow): AccumulatorEntry {
  return {
    memberId: row.member_id,
    policyId: row.policy_id,
    serviceCode: row.service_code,
    benefitPeriodStart: row.benefit_period_start,
    benefitPeriodEnd: row.benefit_period_end,
    metricType: row.metric_type,
    delta: row.delta,
    source: row.source,
    sourceId: row.source_id,
    status: row.status
  };
}
