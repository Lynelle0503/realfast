import { describe, expect, it } from 'vitest';

import { adjudicateClaim } from '../../app/core/application/services/adjudication-service.js';
import type { AccumulatorEntry } from '../../app/core/domain/accumulator.js';
import type { Claim } from '../../app/core/domain/claim.js';
import type { Policy } from '../../app/core/domain/policy.js';

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

const makeClaim = (
  lineItems: Claim['lineItems'],
  overrides: Partial<Pick<Claim, 'dateOfService' | 'lineDecisions'>> = {}
): Claim => ({
  claimId: 'CLM-1',
  memberId: 'MEM-1',
  policyId: 'POL-1',
  provider: { providerId: 'PRV-1', name: 'Provider' },
  dateOfService: '2026-02-01',
  diagnosisCodes: ['J02.9'],
  status: 'submitted',
  approvedLineItemCount: 0,
  lineItems,
  lineDecisions: [],
  ...overrides
});

function adjudicate(claim: Claim, policy = basePolicy, accumulatorEntriesForPolicy: AccumulatorEntry[] = []) {
  const accumulatorEntriesByService = new Map<string, AccumulatorEntry[]>();
  for (const serviceCode of new Set(claim.lineItems.map((lineItem) => lineItem.serviceCode))) {
    accumulatorEntriesByService.set(
      serviceCode,
      accumulatorEntriesForPolicy.filter((entry) => entry.serviceCode === serviceCode)
    );
  }

  return adjudicateClaim({
    claim,
    policy,
    accumulatorEntriesByService,
    accumulatorEntriesForPolicy
  });
}

describe('adjudication service', () => {
  it('approves covered services and posts dollars, visits, and member oop usage', () => {
    const result = adjudicate(
      makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
      ])
    );

    expect(result.lineItems[0]?.status).toBe('approved');
    expect(result.lineDecisions[0]?.payerAmount).toBe(80);
    expect(result.lineDecisions[0]?.memberResponsibility).toBe(20);
    expect(result.accumulatorEntries).toHaveLength(3);
    expect(result.accumulatorEntries.map((entry) => entry.metricType)).toEqual([
      'dollars_paid',
      'visits_used',
      'member_oop_applied'
    ]);
  });

  it('denies uncovered services with a contextual explanation', () => {
    const result = adjudicate(
      makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'prescription', description: 'Antibiotic refill', billedAmount: 100, status: 'submitted' }
      ])
    );

    expect(result.lineItems[0]?.status).toBe('denied');
    expect(result.lineDecisions[0]?.reasonCode).toBe('SERVICE_NOT_COVERED');
    expect(result.lineDecisions[0]?.reasonText).toContain('Antibiotic refill');
  });

  it('denies submitted lines when the claim is missing a service date', () => {
    const result = adjudicate(
      makeClaim(
        [{ lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }],
        { dateOfService: null }
      )
    );

    expect(result.lineItems[0]?.status).toBe('denied');
    expect(result.lineDecisions[0]?.reasonCode).toBe('MISSING_INFORMATION');
    expect(result.lineDecisions[0]?.reasonText).toContain('claim service date');
  });

  it('denies submitted lines when the policy is not active on the service date', () => {
    const result = adjudicate(
      makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
      ], { dateOfService: '2025-12-15' })
    );

    expect(result.lineItems[0]?.status).toBe('denied');
    expect(result.lineDecisions[0]?.reasonCode).toBe('POLICY_NOT_ACTIVE');
    expect(result.lineDecisions[0]?.reasonText).toContain('2025-12-15');
    expect(result.lineDecisions[0]?.reasonText).toContain('2026-01-01');
  });

  it('denies services when the visit cap is exhausted', () => {
    const result = adjudicate(
      makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'lab_test', description: 'Lab', billedAmount: 100, status: 'submitted' }
      ]),
      basePolicy,
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
    );

    expect(result.lineItems[0]?.status).toBe('denied');
    expect(result.lineDecisions[0]?.reasonCode).toBe('VISIT_CAP_EXCEEDED');
  });

  it('routes partial-payment cases to manual review', () => {
    const result = adjudicate(
      makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
      ]),
      {
        ...basePolicy,
        coverageRules: {
          ...basePolicy.coverageRules,
          serviceRules: [{ serviceCode: 'office_visit', covered: true, yearlyDollarCap: 50, yearlyVisitCap: 10 }]
        }
      }
    );

    expect(result.lineItems[0]?.status).toBe('manual_review');
    expect(result.lineDecisions[0]?.reasonCode).toBe('MANUAL_REVIEW_REQUIRED');
    expect(result.lineDecisions[0]?.reasonText).toContain('50.00');
  });

  it('applies the annual out-of-pocket max across the policy year', () => {
    const result = adjudicate(
      makeClaim([
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
      ]),
      {
        ...basePolicy,
        coverageRules: {
          ...basePolicy.coverageRules,
          annualOutOfPocketMax: 10
        }
      },
      [
        {
          memberId: 'MEM-1',
          policyId: 'POL-1',
          serviceCode: 'office_visit',
          benefitPeriodStart: '2026-01-01',
          benefitPeriodEnd: '2026-12-31',
          metricType: 'member_oop_applied',
          delta: 5,
          source: 'claim_line_item',
          sourceId: 'HIST-LI-1',
          status: 'posted'
        }
      ]
    );

    expect(result.lineItems[0]?.status).toBe('approved');
    expect(result.lineDecisions[0]?.payerAmount).toBe(95);
    expect(result.lineDecisions[0]?.memberResponsibility).toBe(5);
    expect(result.accumulatorEntries[2]).toEqual(expect.objectContaining({ metricType: 'member_oop_applied', delta: 5 }));
  });
});
