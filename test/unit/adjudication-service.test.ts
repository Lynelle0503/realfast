import { describe, expect, it } from 'vitest';

import { adjudicateClaim } from '../../src/core/application/services/adjudication-service.js';
import type { Claim } from '../../src/core/domain/claim.js';
import type { Policy } from '../../src/core/domain/policy.js';

const basePolicy: Policy = {
  policyId: 'POL-1',
  memberId: 'MEM-1',
  policyType: 'Health PPO',
  effectiveDate: '2026-01-01',
  coverageRules: {
    benefitPeriod: 'policy_year',
    deductible: 0,
    coinsurancePercent: 80,
    annualOutOfPocketMax: 3000,
    serviceRules: [
      { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 },
      { serviceCode: 'lab_test', covered: true, yearlyDollarCap: 500, yearlyVisitCap: 1 },
      { serviceCode: 'prescription', covered: false, yearlyDollarCap: null, yearlyVisitCap: null }
    ]
  }
};

const makeClaim = (lineItems: Claim['lineItems']): Claim => ({
  claimId: 'CLM-1',
  memberId: 'MEM-1',
  policyId: 'POL-1',
  provider: { providerId: 'PRV-1', name: 'Provider' },
  diagnosisCodes: ['J02.9'],
  status: 'submitted',
  approvedLineItemCount: 0,
  lineItems,
  lineDecisions: []
});

describe('adjudication service', () => {
  it('approves covered services and creates accumulator entries', () => {
    const result = adjudicateClaim({
      claim: makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
      ]),
      policy: basePolicy,
      accumulatorEntriesByService: new Map(),
      asOfDate: new Date('2026-02-01T00:00:00.000Z')
    });

    expect(result.lineItems[0]?.status).toBe('approved');
    expect(result.lineDecisions[0]?.payerAmount).toBe(80);
    expect(result.accumulatorEntries).toHaveLength(2);
  });

  it('denies uncovered services with a reason', () => {
    const result = adjudicateClaim({
      claim: makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'prescription', description: 'Rx', billedAmount: 100, status: 'submitted' }
      ]),
      policy: basePolicy,
      accumulatorEntriesByService: new Map(),
      asOfDate: new Date('2026-02-01T00:00:00.000Z')
    });

    expect(result.lineItems[0]?.status).toBe('denied');
    expect(result.lineDecisions[0]?.reasonCode).toBe('SERVICE_NOT_COVERED');
  });

  it('denies services when visit cap is exhausted', () => {
    const result = adjudicateClaim({
      claim: makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'lab_test', description: 'Lab', billedAmount: 100, status: 'submitted' }
      ]),
      policy: basePolicy,
      accumulatorEntriesByService: new Map([
        [
          'lab_test',
          [
            {
              memberId: 'MEM-1',
              policyId: 'POL-1',
              serviceCode: 'lab_test',
              benefitPeriodStart: '2026-01-01',
              benefitPeriodEnd: '2026-12-31',
              metricType: 'visits_used',
              delta: 1,
              source: 'claim_line_item',
              sourceId: 'LI-0',
              status: 'posted'
            }
          ]
        ]
      ]),
      asOfDate: new Date('2026-02-01T00:00:00.000Z')
    });

    expect(result.lineItems[0]?.status).toBe('denied');
    expect(result.lineDecisions[0]?.reasonCode).toBe('VISIT_CAP_EXCEEDED');
  });

  it('routes partial-payment cases to manual review', () => {
    const result = adjudicateClaim({
      claim: makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
      ]),
      policy: {
        ...basePolicy,
        coverageRules: {
          ...basePolicy.coverageRules,
          serviceRules: [
            { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 50, yearlyVisitCap: 10 }
          ]
        }
      },
      accumulatorEntriesByService: new Map(),
      asOfDate: new Date('2026-02-01T00:00:00.000Z')
    });

    expect(result.lineItems[0]?.status).toBe('manual_review');
    expect(result.lineDecisions[0]?.reasonCode).toBe('MANUAL_REVIEW_REQUIRED');
  });
});
