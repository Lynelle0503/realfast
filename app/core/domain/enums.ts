export const CLAIM_STATUSES = ['submitted', 'under_review', 'approved', 'paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const LINE_ITEM_STATUSES = [
  'submitted',
  'approved',
  'denied',
  'manual_review',
  'paid'
] as const;
export type LineItemStatus = (typeof LINE_ITEM_STATUSES)[number];

export const LINE_DECISION_TYPES = ['approved', 'denied', 'manual_review'] as const;
export type LineDecisionType = (typeof LINE_DECISION_TYPES)[number];

export const REASON_CODES = [
  'SERVICE_NOT_COVERED',
  'YEARLY_CAP_EXCEEDED',
  'VISIT_CAP_EXCEEDED',
  'MISSING_INFORMATION',
  'POLICY_NOT_ACTIVE',
  'MANUAL_REVIEW_REQUIRED'
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const BENEFIT_PERIODS = ['policy_year'] as const;
export type BenefitPeriod = (typeof BENEFIT_PERIODS)[number];

export const ACCUMULATOR_METRIC_TYPES = ['dollars_paid', 'visits_used'] as const;
export type AccumulatorMetricType = (typeof ACCUMULATOR_METRIC_TYPES)[number];

export const ACCUMULATOR_ENTRY_STATUSES = ['posted', 'reversed'] as const;
export type AccumulatorEntryStatus = (typeof ACCUMULATOR_ENTRY_STATUSES)[number];

export const DISPUTE_STATUSES = ['open'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
