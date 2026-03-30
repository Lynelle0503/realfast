import { afterEach, describe, expect, it } from 'vitest';

import type { Server } from 'node:http';

import { SqliteAccumulatorRepository } from '../../app/infra/db/repositories/sqlite-accumulator-repository.js';
import { SqliteClaimRepository } from '../../app/infra/db/repositories/sqlite-claim-repository.js';
import { SqliteDisputeRepository } from '../../app/infra/db/repositories/sqlite-dispute-repository.js';
import { SqliteMemberRepository } from '../../app/infra/db/repositories/sqlite-member-repository.js';
import { SqlitePolicyRepository } from '../../app/infra/db/repositories/sqlite-policy-repository.js';
import { initializeDatabase } from '../../app/infra/db/sqlite.js';
import { SystemClock } from '../../app/infra/db/support/clock.js';
import { DeterministicIdGenerator } from '../../app/infra/db/support/ids.js';
import { createApiServer } from '../../app/infra/http/api.js';
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

async function startServer(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server address was not available.');
  }

  return `http://127.0.0.1:${address.port}/api/v1`;
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe('http api', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await stopServer(server);
      }
    }
  });

  it('serves the documented member, policy, claim, adjudication, payment, and dispute endpoints', async () => {
    const { filePath, close } = createDb();
    close();

    const db = initializeDatabase({ filePath });
    const memberRepository = new SqliteMemberRepository(db);
    const policyRepository = new SqlitePolicyRepository(db);
    const claimRepository = new SqliteClaimRepository(db);
    const disputeRepository = new SqliteDisputeRepository(db);
    const accumulatorRepository = new SqliteAccumulatorRepository(db);
    const server = createApiServer({
      memberRepository,
      policyRepository,
      claimRepository,
      disputeRepository,
      accumulatorRepository,
      idGenerator: new DeterministicIdGenerator(),
      clock: new FixedClock(new Date('2026-03-01T00:00:00.000Z'))
    });
    servers.push(server);

    const baseUrl = await startServer(server);

    const memberResponse = await fetch(`${baseUrl}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Aarav Mehta', dateOfBirth: '1988-07-14' })
    });
    expect(memberResponse.status).toBe(201);
    const member = (await memberResponse.json()) as { memberId: string; fullName: string; dateOfBirth: string };
    expect(member).toEqual({
      memberId: 'MEM-0001',
      fullName: 'Aarav Mehta',
      dateOfBirth: '1988-07-14'
    });

    const membersResponse = await fetch(`${baseUrl}/members`);
    expect(membersResponse.status).toBe(200);
    await expect(membersResponse.json()).resolves.toEqual({ items: [member] });

    const fetchedMemberResponse = await fetch(`${baseUrl}/members/${member.memberId}`);
    expect(fetchedMemberResponse.status).toBe(200);
    await expect(fetchedMemberResponse.json()).resolves.toEqual(member);

    const policyResponse = await fetch(`${baseUrl}/members/${member.memberId}/policies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
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
      })
    });
    expect(policyResponse.status).toBe(201);
    const policy = (await policyResponse.json()) as { policyId: string; memberId: string };
    expect(policy.policyId).toBe('POL-0001');
    expect(policy.memberId).toBe(member.memberId);

    const policiesResponse = await fetch(`${baseUrl}/members/${member.memberId}/policies`);
    expect(policiesResponse.status).toBe(200);
    await expect(policiesResponse.json()).resolves.toEqual({ items: [policy] });

    const fetchedPolicyResponse = await fetch(`${baseUrl}/policies/${policy.policyId}`);
    expect(fetchedPolicyResponse.status).toBe(200);
    await expect(fetchedPolicyResponse.json()).resolves.toEqual(policy);

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
      }
    ]);

    const claimResponse = await fetch(`${baseUrl}/claims`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memberId: member.memberId,
        policyId: policy.policyId,
        provider: { providerId: 'PRV-0501', name: 'CityCare Clinic' },
        dateOfService: '2026-03-01',
        diagnosisCodes: ['J02.9'],
        lineItems: [
          { serviceCode: 'office_visit', description: 'Primary care consultation', billedAmount: 150 },
          { serviceCode: 'prescription', description: 'Antibiotic prescription', billedAmount: 50 },
          { serviceCode: 'lab_test', description: 'Follow-up lab panel', billedAmount: 80 }
        ]
      })
    });
    expect(claimResponse.status).toBe(201);
    const createdClaim = (await claimResponse.json()) as {
      claimId: string;
      dateOfService: string | null;
      status: string;
      approvedLineItemCount: number;
      lineItems: Array<{ lineItemId: string; dateOfService: string | null }>;
      lineDecisions: unknown[];
    };
    expect(createdClaim.claimId).toBe('CLM-0001');
    expect(createdClaim.dateOfService).toBe('2026-03-01');
    expect(createdClaim.status).toBe('submitted');
    expect(createdClaim.approvedLineItemCount).toBe(0);
    expect(createdClaim.lineItems.map((lineItem) => lineItem.dateOfService)).toEqual([
      '2026-03-01',
      '2026-03-01',
      '2026-03-01'
    ]);
    expect(createdClaim.lineDecisions).toEqual([]);

    const claimsResponse = await fetch(`${baseUrl}/members/${member.memberId}/claims`);
    expect(claimsResponse.status).toBe(200);
    await expect(claimsResponse.json()).resolves.toEqual({
      items: [
        {
          claimId: createdClaim.claimId,
          memberId: member.memberId,
          policyId: policy.policyId,
          dateOfService: '2026-03-01',
          status: 'submitted',
          approvedLineItemCount: 0
        }
      ]
    });

    const adjudicationResponse = await fetch(`${baseUrl}/claims/${createdClaim.claimId}/adjudications`, {
      method: 'POST'
    });
    expect(adjudicationResponse.status).toBe(200);
    const adjudication = (await adjudicationResponse.json()) as {
      claim: {
        claimId: string;
        status: string;
        approvedLineItemCount: number;
        lineItems: Array<{ lineItemId: string; status: string }>;
        lineDecisions: Array<{
          lineItemId: string;
          decision: string;
          reasonCode: string | null;
          reasonText: string | null;
          memberNextStep?: string | null;
          payerAmount: number | null;
          memberResponsibility: number | null;
        }>;
      };
      accumulatorEffects: Array<{ sourceId: string; metricType: string; delta: number }>;
    };
    expect(adjudication.claim.status).toBe('under_review');
    expect(adjudication.claim.approvedLineItemCount).toBe(1);
    expect(adjudication.accumulatorEffects).toEqual([
      expect.objectContaining({ sourceId: 'LI-0001', metricType: 'dollars_paid', delta: 120 }),
      expect.objectContaining({ sourceId: 'LI-0001', metricType: 'visits_used', delta: 1 }),
      expect.objectContaining({ sourceId: 'LI-0001', metricType: 'member_oop_applied', delta: 30 })
    ]);

    const approvedDecision = adjudication.claim.lineDecisions.find((decision) => decision.lineItemId === 'LI-0001');
    const deniedDecision = adjudication.claim.lineDecisions.find((decision) => decision.lineItemId === 'LI-0002');
    const manualReviewDecision = adjudication.claim.lineDecisions.find((decision) => decision.lineItemId === 'LI-0003');

    expect(approvedDecision).toEqual({
      lineItemId: 'LI-0001',
      decision: 'approved',
      reasonCode: null,
      reasonText: null,
      memberNextStep: null,
      payerAmount: 120,
      memberResponsibility: 30
    });
    expect(deniedDecision).toEqual(
      expect.objectContaining({
        lineItemId: 'LI-0002',
        decision: 'denied',
        reasonCode: 'SERVICE_NOT_COVERED',
        memberNextStep: 'You can dispute this decision if you believe it should be covered.',
        payerAmount: 0,
        memberResponsibility: 50
      })
    );
    expect(deniedDecision?.reasonText).toContain('Antibiotic prescription');
    expect(manualReviewDecision).toEqual(
      expect.objectContaining({
        lineItemId: 'LI-0003',
        decision: 'manual_review',
        reasonCode: 'MANUAL_REVIEW_REQUIRED',
        memberNextStep: null,
        payerAmount: null,
        memberResponsibility: null
      })
    );
    expect(manualReviewDecision?.reasonText).toContain('Follow-up lab panel');

    const claimDetailResponse = await fetch(`${baseUrl}/claims/${createdClaim.claimId}`);
    expect(claimDetailResponse.status).toBe(200);
    const claimDetail = (await claimDetailResponse.json()) as typeof adjudication.claim;
    expect(claimDetail.lineDecisions).toEqual(adjudication.claim.lineDecisions);

    const reviewDecisionResponse = await fetch(`${baseUrl}/claims/${createdClaim.claimId}/line-items/LI-0003/review-decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' })
    });
    expect(reviewDecisionResponse.status).toBe(200);
    const reviewedClaim = (await reviewDecisionResponse.json()) as typeof adjudication.claim;
    expect(reviewedClaim.status).toBe('approved');
    expect(reviewedClaim.approvedLineItemCount).toBe(2);

    const paymentResponse = await fetch(`${baseUrl}/claims/${createdClaim.claimId}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineItemIds: ['LI-0001', 'LI-0003'] })
    });
    expect(paymentResponse.status).toBe(200);
    const paidClaim = (await paymentResponse.json()) as typeof adjudication.claim;
    expect(paidClaim.status).toBe('paid');

    const openDisputeResponse = await fetch(`${baseUrl}/claims/${createdClaim.claimId}/disputes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'I disagree with the prescription denial.',
        note: 'Please review the benefit setup again.',
        referencedLineItemIds: ['LI-0002']
      })
    });
    expect(openDisputeResponse.status).toBe(201);
    const dispute = (await openDisputeResponse.json()) as {
      disputeId: string;
      claimId: string;
      memberId: string;
      status: string;
      reason: string;
      note: string | null;
      referencedLineItemIds: string[];
      resolvedAt: string | null;
      resolutionNote: string | null;
    };
    expect(dispute).toEqual({
      disputeId: 'DSP-0001',
      claimId: createdClaim.claimId,
      memberId: member.memberId,
      status: 'open',
      reason: 'I disagree with the prescription denial.',
      note: 'Please review the benefit setup again.',
      referencedLineItemIds: ['LI-0002'],
      resolvedAt: null,
      resolutionNote: null
    });

    const disputesResponse = await fetch(`${baseUrl}/claims/${createdClaim.claimId}/disputes`);
    expect(disputesResponse.status).toBe(200);
    await expect(disputesResponse.json()).resolves.toEqual({ items: [dispute] });

    const disputeDetailResponse = await fetch(`${baseUrl}/disputes/${dispute.disputeId}`);
    expect(disputeDetailResponse.status).toBe(200);
    await expect(disputeDetailResponse.json()).resolves.toEqual(dispute);

    const disputeResolutionResponse = await fetch(`${baseUrl}/disputes/${dispute.disputeId}/resolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'overturned', note: 'Manual approval after review.' })
    });
    expect(disputeResolutionResponse.status).toBe(200);
    const resolvedDispute = (await disputeResolutionResponse.json()) as {
      dispute: { status: string; resolutionNote: string | null; resolvedAt: string | null };
      claim: { status: string; approvedLineItemCount: number; lineItems: Array<{ lineItemId: string; status: string }> };
      accumulatorEffects: Array<{ sourceId: string; metricType: string; delta: number }>;
    };
    expect(resolvedDispute.dispute.status).toBe('overturned');
    expect(resolvedDispute.dispute.resolutionNote).toBe('Manual approval after review.');
    expect(resolvedDispute.dispute.resolvedAt).toBeTruthy();
    expect(resolvedDispute.claim.status).toBe('paid');
    expect(resolvedDispute.claim.approvedLineItemCount).toBe(2);
    expect(resolvedDispute.claim.lineItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ lineItemId: 'LI-0002', status: 'denied' })])
    );
    expect(resolvedDispute.accumulatorEffects).toEqual([]);

    const finalClaimsResponse = await fetch(`${baseUrl}/members/${member.memberId}/claims`);
    expect(finalClaimsResponse.status).toBe(200);
    await expect(finalClaimsResponse.json()).resolves.toEqual({
      items: [
        {
          claimId: createdClaim.claimId,
          memberId: member.memberId,
          policyId: policy.policyId,
          dateOfService: '2026-03-01',
          status: 'paid',
          approvedLineItemCount: 2
        }
      ]
    });

    db.close();
  });
});
