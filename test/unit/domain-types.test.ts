import { describe, expect, it } from 'vitest';

import {
  ACCUMULATOR_ENTRY_STATUSES,
  ACCUMULATOR_METRIC_TYPES,
  BENEFIT_PERIODS,
  CLAIM_STATUSES,
  DISPUTE_STATUSES,
  LINE_DECISION_TYPES,
  LINE_ITEM_STATUSES,
  REASON_CODES
} from '../../app/core/domain/enums.js';

describe('domain enums', () => {
  it('exposes the documented claim statuses', () => {
    expect(CLAIM_STATUSES).toEqual(['submitted', 'under_review', 'approved', 'paid']);
  });

  it('exposes the documented line item statuses', () => {
    expect(LINE_ITEM_STATUSES).toEqual(['submitted', 'approved', 'denied', 'manual_review', 'paid']);
  });

  it('exposes the documented line decision types', () => {
    expect(LINE_DECISION_TYPES).toEqual(['approved', 'denied', 'manual_review']);
  });

  it('exposes the documented reason codes', () => {
    expect(REASON_CODES).toEqual([
      'SERVICE_NOT_COVERED',
      'YEARLY_CAP_EXCEEDED',
      'VISIT_CAP_EXCEEDED',
      'MISSING_INFORMATION',
      'POLICY_NOT_ACTIVE',
      'MANUAL_REVIEW_REQUIRED'
    ]);
  });

  it('exposes the documented coverage and accumulator enums', () => {
    expect(BENEFIT_PERIODS).toEqual(['policy_year']);
    expect(ACCUMULATOR_METRIC_TYPES).toEqual(['dollars_paid', 'visits_used', 'member_oop_applied']);
    expect(ACCUMULATOR_ENTRY_STATUSES).toEqual(['posted', 'reversed']);
    expect(DISPUTE_STATUSES).toEqual(['open', 'upheld', 'overturned']);
  });
});
