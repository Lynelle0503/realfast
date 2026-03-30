import { describe, expect, it } from 'vitest';

import { adjudicateClaimCommand } from '../../app/core/application/commands/adjudicate-claim.js';
import { createClaim } from '../../app/core/application/commands/create-claim.js';
import { createMember } from '../../app/core/application/commands/create-member.js';
import { createPolicy } from '../../app/core/application/commands/create-policy.js';
import { markClaimPayment } from '../../app/core/application/commands/mark-claim-payment.js';
import { openDispute } from '../../app/core/application/commands/open-dispute.js';
import { resolveDisputeCommand } from '../../app/core/application/commands/resolve-dispute.js';
import { resolveManualReviewCommand } from '../../app/core/application/commands/resolve-manual-review.js';
import { getClaim } from '../../app/core/application/queries/get-claim.js';
import { listClaimDisputes } from '../../app/core/application/queries/list-claim-disputes.js';
import { SystemClock } from '../../app/infra/db/support/clock.js';
import { DeterministicIdGenerator } from '../../app/infra/db/support/ids.js';
import { SqliteAccumulatorRepository } from '../../app/infra/db/repositories/sqlite-accumulator-repository.js';
import { SqliteClaimRepository } from '../../app/infra/db/repositories/sqlite-claim-repository.js';
import { SqliteDisputeRepository } from '../../app/infra/db/repositories/sqlite-dispute-repository.js';
import { SqliteMemberRepository } from '../../app/infra/db/repositories/sqlite-member-repository.js';
import { SqlitePolicyRepository } from '../../app/infra/db/repositories/sqlite-policy-repository.js';
import { withSqliteDatabase } from './sqlite-test-helpers.js';

const createDb = withSqliteDatabase();

class FixedClock extends SystemClock {
  constructor(private readonly value: Date) {
    super();
  }

  override now(): Date {
    return this.value;
  }
}

describe('sqlite application workflows', () => {
  it('runs the Phase 2 commands end to end against sqlite persistence', async () => {
    const { db, close } = createDb();

    const memberRepository = new SqliteMemberRepository(db);
    const policyRepository = new SqlitePolicyRepository(db);
    const claimRepository = new SqliteClaimRepository(db);
    const disputeRepository = new SqliteDisputeRepository(db);
    const accumulatorRepository = new SqliteAccumulatorRepository(db);
    const idGenerator = new DeterministicIdGenerator();
    const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));

    const member = await createMember(
      { memberRepository, idGenerator },
      { fullName: 'Aarav Mehta', dateOfBirth: '1988-07-14' }
    );

    const policy = await createPolicy(
      { memberRepository, policyRepository, idGenerator },
      {
        memberId: member.memberId,
        policyType: 'Health PPO',
        effectiveDate: '2026-01-01',
        coverageRules: {
          benefitPeriod: 'policy_year',
          deductible: 0,
          coinsurancePercent: 80,
          annualOutOfPocketMax: 3000,
          serviceRules: [
            { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 },
            { serviceCode: 'lab_test', covered: true, yearlyDollarCap: 100, yearlyVisitCap: null },
            { serviceCode: 'prescription', covered: false, yearlyDollarCap: null, yearlyVisitCap: null }
          ]
        }
      }
    );

    await accumulatorRepository.appendMany([
      {
        memberId: member.memberId,
        policyId: policy.policyId,
        serviceCode: 'lab_test',
        benefitPeriodStart: '2026-01-01',
        benefitPeriodEnd: '2026-12-31',
        metricType: 'dollars_paid',
        delta: 50,
        source: 'claim_line_item',
        sourceId: 'HIST-LI-0001',
        status: 'posted'
      },
      {
        memberId: member.memberId,
        policyId: policy.policyId,
        serviceCode: 'lab_test',
        benefitPeriodStart: '2026-01-01',
        benefitPeriodEnd: '2026-12-31',
        metricType: 'visits_used',
        delta: 1,
        source: 'claim_line_item',
        sourceId: 'HIST-LI-0001',
        status: 'posted'
      },
      {
        memberId: member.memberId,
        policyId: policy.policyId,
        serviceCode: 'lab_test',
        benefitPeriodStart: '2026-01-01',
        benefitPeriodEnd: '2026-12-31',
        metricType: 'member_oop_applied',
        delta: 12.5,
        source: 'claim_line_item',
        sourceId: 'HIST-LI-0001',
        status: 'posted'
      }
    ]);

    const claim = await createClaim(
      { memberRepository, policyRepository, claimRepository, idGenerator },
      {
        memberId: member.memberId,
        policyId: policy.policyId,
        provider: { providerId: 'PRV-0001', name: 'CityCare Clinic' },
        dateOfService: '2026-03-01',
        diagnosisCodes: ['J02.9'],
        lineItems: [
          { serviceCode: 'office_visit', description: 'Primary care consultation', billedAmount: 150 },
          { serviceCode: 'prescription', description: 'Antibiotic prescription', billedAmount: 50 },
          { serviceCode: 'lab_test', description: 'Follow-up lab panel', billedAmount: 80 }
        ]
      }
    );

    const adjudicated = await adjudicateClaimCommand(
      { claimRepository, policyRepository, accumulatorRepository, clock },
      claim.claimId
    );

    expect(adjudicated.claim.status).toBe('under_review');
    expect(adjudicated.claim.approvedLineItemCount).toBe(1);
    expect(adjudicated.claim.lineItems.map((lineItem) => lineItem.status)).toEqual([
      'approved',
      'denied',
      'manual_review'
    ]);

    const manualReviewLine = adjudicated.claim.lineItems.find((lineItem) => lineItem.status === 'manual_review');
    expect(manualReviewLine).toBeDefined();

    const resolved = await resolveManualReviewCommand(
      { claimRepository, policyRepository, accumulatorRepository, clock },
      { claimId: claim.claimId, lineItemId: manualReviewLine!.lineItemId, decision: 'approved' }
    );

    expect(resolved.claim.status).toBe('approved');
    expect(resolved.claim.approvedLineItemCount).toBe(2);

    const lineItemIdsToPay = resolved.claim.lineItems
      .filter((lineItem) => lineItem.status === 'approved')
      .map((lineItem) => lineItem.lineItemId);

    const paid = await markClaimPayment({ claimRepository }, { claimId: claim.claimId, lineItemIds: lineItemIdsToPay });
    expect(paid.claim.status).toBe('paid');

    const deniedLine = paid.claim.lineItems.find((lineItem) => lineItem.status === 'denied');
    expect(deniedLine).toBeDefined();

    const dispute = await openDispute(
      { claimRepository, disputeRepository, idGenerator },
      {
        claimId: claim.claimId,
        memberId: member.memberId,
        reason: 'I disagree with the denial.',
        referencedLineItemIds: [deniedLine!.lineItemId]
      }
    );

    const overturned = await resolveDisputeCommand(
      { claimRepository, policyRepository, disputeRepository, accumulatorRepository, clock },
      { disputeId: dispute.disputeId, outcome: 'overturned', note: 'Manual approval after dispute review.' }
    );

    const persistedClaim = await getClaim(claimRepository, claim.claimId);
    const disputes = await listClaimDisputes(disputeRepository, claim.claimId);
    const accumulatorEntries = await accumulatorRepository.listByPolicyAndService(policy.policyId, 'lab_test');

    expect(overturned.dispute.status).toBe('overturned');
    expect(persistedClaim.status).toBe('paid');
    expect(persistedClaim.approvedLineItemCount).toBe(2);
    expect(persistedClaim.lineDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision: 'approved', lineItemId: lineItemIdsToPay[0] }),
        expect.objectContaining({ decision: 'approved', lineItemId: manualReviewLine!.lineItemId }),
        expect.objectContaining({
          decision: 'denied',
          lineItemId: deniedLine!.lineItemId,
          reasonCode: 'SERVICE_NOT_COVERED'
        })
      ])
    );
    expect(disputes).toEqual([
      expect.objectContaining({
        disputeId: dispute.disputeId,
        status: 'overturned',
        resolutionNote: 'Manual approval after dispute review.'
      })
    ]);
    expect(accumulatorEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'HIST-LI-0001', delta: 50 }),
        expect.objectContaining({ sourceId: manualReviewLine!.lineItemId, metricType: 'dollars_paid', delta: 50 })
      ])
    );
    expect(accumulatorEntries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: deniedLine!.lineItemId })])
    );

    close();
  });
});
