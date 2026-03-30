import { describe, expect, it } from 'vitest';

import { adjudicateClaimCommand } from '../../app/core/application/commands/adjudicate-claim.js';
import { createClaim } from '../../app/core/application/commands/create-claim.js';
import { markClaimPayment } from '../../app/core/application/commands/mark-claim-payment.js';
import { openDispute } from '../../app/core/application/commands/open-dispute.js';
import { resolveManualReviewCommand } from '../../app/core/application/commands/resolve-manual-review.js';
import { BusinessRuleError } from '../../app/core/application/errors/business-rule-error.js';
import type { AccumulatorEntry } from '../../app/core/domain/accumulator.js';
import type { Claim } from '../../app/core/domain/claim.js';
import type { Dispute } from '../../app/core/domain/dispute.js';
import type { Member } from '../../app/core/domain/member.js';
import type { Policy } from '../../app/core/domain/policy.js';
import type {
  AccumulatorRepository,
  ClaimRepository,
  Clock,
  DisputeRepository,
  IdGenerator,
  MemberRepository,
  PolicyRepository
} from '../../app/core/ports/repositories.js';

class FakeIdGenerator implements IdGenerator {
  private counter = 1;

  next(prefix: string): string {
    const id = `${prefix}-${this.counter}`;
    this.counter += 1;
    return id;
  }
}

class FakeClock implements Clock {
  now(): Date {
    return new Date('2026-02-01T00:00:00.000Z');
  }
}

class InMemoryMemberRepository implements MemberRepository {
  constructor(private readonly members: Member[]) {}

  async create(member: Member): Promise<void> {
    this.members.push(member);
  }

  async getById(memberId: string): Promise<Member | null> {
    return this.members.find((member) => member.memberId === memberId) ?? null;
  }

  async listAll(): Promise<Member[]> {
    return [...this.members];
  }
}

class InMemoryPolicyRepository implements PolicyRepository {
  constructor(private readonly policies: Policy[]) {}

  async create(policy: Policy): Promise<void> {
    this.policies.push(policy);
  }

  async getById(policyId: string): Promise<Policy | null> {
    return this.policies.find((policy) => policy.policyId === policyId) ?? null;
  }

  async listByMemberId(memberId: string): Promise<Policy[]> {
    return this.policies.filter((policy) => policy.memberId === memberId);
  }
}

class InMemoryClaimRepository implements ClaimRepository {
  constructor(private readonly claims: Claim[]) {}

  async create(claim: Claim): Promise<void> {
    this.claims.push(claim);
  }

  async update(claim: Claim): Promise<void> {
    const index = this.claims.findIndex((item) => item.claimId === claim.claimId);
    this.claims[index] = claim;
  }

  async getById(claimId: string): Promise<Claim | null> {
    return this.claims.find((claim) => claim.claimId === claimId) ?? null;
  }

  async listByMemberId(memberId: string): Promise<Claim[]> {
    return this.claims.filter((claim) => claim.memberId === memberId);
  }
}

class InMemoryDisputeRepository implements DisputeRepository {
  constructor(private readonly disputes: Dispute[]) {}

  async create(dispute: Dispute): Promise<void> {
    this.disputes.push(dispute);
  }

  async getById(disputeId: string): Promise<Dispute | null> {
    return this.disputes.find((dispute) => dispute.disputeId === disputeId) ?? null;
  }

  async listByClaimId(claimId: string): Promise<Dispute[]> {
    return this.disputes.filter((dispute) => dispute.claimId === claimId);
  }
}

class InMemoryAccumulatorRepository implements AccumulatorRepository {
  constructor(private readonly entries: AccumulatorEntry[]) {}

  async append(entry: AccumulatorEntry): Promise<void> {
    this.entries.push(entry);
  }

  async appendMany(entries: AccumulatorEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  async listByPolicyAndService(policyId: string, serviceCode: string): Promise<AccumulatorEntry[]> {
    return this.entries.filter((entry) => entry.policyId === policyId && entry.serviceCode === serviceCode);
  }
}

const member: Member = {
  memberId: 'MEM-1',
  fullName: 'Aarav Mehta',
  dateOfBirth: '1988-07-14'
};

const policy: Policy = {
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
      { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 }
    ]
  }
};

describe('application commands', () => {
  it('rejects duplicate claims for the same member and policy', async () => {
    const claims: Claim[] = [
      {
        claimId: 'CLM-existing',
        memberId: 'MEM-1',
        policyId: 'POL-1',
        provider: { providerId: 'PRV-1', name: 'Provider' },
        diagnosisCodes: ['J02.9'],
        status: 'submitted',
        approvedLineItemCount: 0,
        lineItems: [],
        lineDecisions: []
      }
    ];

    await expect(
      createClaim(
        {
          memberRepository: new InMemoryMemberRepository([member]),
          policyRepository: new InMemoryPolicyRepository([policy]),
          claimRepository: new InMemoryClaimRepository(claims),
          idGenerator: new FakeIdGenerator()
        },
        {
          memberId: 'MEM-1',
          policyId: 'POL-1',
          provider: { providerId: 'PRV-1', name: 'Provider' },
          diagnosisCodes: ['J02.9'],
          lineItems: [{ serviceCode: 'office_visit', description: 'Visit', billedAmount: 100 }]
        }
      )
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('adjudicates a claim and marks it approved when all lines resolve', async () => {
    const claims: Claim[] = [
      {
        claimId: 'CLM-1',
        memberId: 'MEM-1',
        policyId: 'POL-1',
        provider: { providerId: 'PRV-1', name: 'Provider' },
        diagnosisCodes: ['J02.9'],
        status: 'submitted',
        approvedLineItemCount: 0,
        lineItems: [
          { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'submitted' }
        ],
        lineDecisions: []
      }
    ];

    const result = await adjudicateClaimCommand(
      {
        claimRepository: new InMemoryClaimRepository(claims),
        policyRepository: new InMemoryPolicyRepository([policy]),
        accumulatorRepository: new InMemoryAccumulatorRepository([]),
        clock: new FakeClock()
      },
      'CLM-1'
    );

    expect(result.claim.status).toBe('approved');
    expect(result.claim.approvedLineItemCount).toBe(1);
  });

  it('resolves manual review lines and updates the claim status', async () => {
    const claims: Claim[] = [
      {
        claimId: 'CLM-1',
        memberId: 'MEM-1',
        policyId: 'POL-1',
        provider: { providerId: 'PRV-1', name: 'Provider' },
        diagnosisCodes: ['J02.9'],
        status: 'under_review',
        approvedLineItemCount: 0,
        lineItems: [
          { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'manual_review' }
        ],
        lineDecisions: [
          {
            lineItemId: 'LI-1',
            decision: 'manual_review',
            reasonCode: 'MANUAL_REVIEW_REQUIRED',
            reasonText: 'This service is still under review because it needs additional review before a final decision can be made.',
            memberNextStep: null,
            payerAmount: null,
            memberResponsibility: null
          }
        ]
      }
    ];

    const result = await resolveManualReviewCommand(
      {
        claimRepository: new InMemoryClaimRepository(claims),
        policyRepository: new InMemoryPolicyRepository([policy]),
        accumulatorRepository: new InMemoryAccumulatorRepository([]),
        clock: new FakeClock()
      },
      { claimId: 'CLM-1', lineItemId: 'LI-1', decision: 'approved' }
    );

    expect(result.claim.status).toBe('approved');
    expect(result.claim.lineItems[0]?.status).toBe('approved');
  });

  it('marks approved line items as paid and rolls claim status to paid', async () => {
    const claims: Claim[] = [
      {
        claimId: 'CLM-1',
        memberId: 'MEM-1',
        policyId: 'POL-1',
        provider: { providerId: 'PRV-1', name: 'Provider' },
        diagnosisCodes: ['J02.9'],
        status: 'approved',
        approvedLineItemCount: 1,
        lineItems: [
          { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'Visit', billedAmount: 100, status: 'approved' }
        ],
        lineDecisions: []
      }
    ];

    const result = await markClaimPayment(
      { claimRepository: new InMemoryClaimRepository(claims) },
      { claimId: 'CLM-1', lineItemIds: ['LI-1'] }
    );

    expect(result.claim.status).toBe('paid');
    expect(result.claim.lineItems[0]?.status).toBe('paid');
  });

  it('creates claim-level disputes', async () => {
    const claims: Claim[] = [
      {
        claimId: 'CLM-1',
        memberId: 'MEM-1',
        policyId: 'POL-1',
        provider: { providerId: 'PRV-1', name: 'Provider' },
        diagnosisCodes: ['J02.9'],
        status: 'approved',
        approvedLineItemCount: 1,
        lineItems: [],
        lineDecisions: []
      }
    ];

    const dispute = await openDispute(
      {
        claimRepository: new InMemoryClaimRepository(claims),
        disputeRepository: new InMemoryDisputeRepository([]),
        idGenerator: new FakeIdGenerator()
      },
      {
        claimId: 'CLM-1',
        memberId: 'MEM-1',
        reason: 'Incorrect denial',
        referencedLineItemIds: ['LI-4']
      }
    );

    expect(dispute.status).toBe('open');
    expect(dispute.referencedLineItemIds).toEqual(['LI-4']);
  });
});
