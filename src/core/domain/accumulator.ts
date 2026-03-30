import type { AccumulatorEntryStatus, AccumulatorMetricType } from './enums.js';

export interface AccumulatorEntry {
  memberId: string;
  policyId: string;
  serviceCode: string;
  benefitPeriodStart: string;
  benefitPeriodEnd: string;
  metricType: AccumulatorMetricType;
  delta: number;
  source: 'claim_line_item';
  sourceId: string;
  status: AccumulatorEntryStatus;
}
