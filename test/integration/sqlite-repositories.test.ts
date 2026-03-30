import { describe, expect, it } from 'vitest';

import type { AccumulatorEntry } from '../../app/core/domain/accumulator.js';
import type { Claim } from '../../app/core/domain/claim.js';
import type { Dispute } from '../../app/core/domain/dispute.js';
import type { Member } from '../../app/core/domain/member.js';
import type { Policy } from '../../app/core/domain/policy.js';
import { SqliteAccumulatorRepository } from '../../app/infra/db/repositories/sqlite-accumulator-repository.js';
import { SqliteClaimRepository } from '../../app/infra/db/repositories/sqlite-claim-repository.js';
import { SqliteDisputeRepository } from '../../app/infra/db/repositories/sqlite-dispute-repository.js';
import { SqliteMemberRepository } from '../../app/infra/db/repositories/sqlite-member-repository.js';
import { SqlitePolicyRepository } from '../../app/infra/db/repositories/sqlite-policy-repository.js';
import { withSqliteDatabase } from './sqlite-test-helpers.js';

const createDb = withSqliteDatabase();

describe('sqlite repositories', () => {
  it('creates and fetches a member', async () => {
    const { db, close } = createDb();
    const repository = new SqliteMemberRepository(db);

    const member: Member = {
      memberId: 'MEM-0001',
      fullName: 'Aarav Mehta',
      dateOfBirth: '1988-07-14'
    };

    await repository.create(member);
    await expect(repository.getById(member.memberId)).resolves.toEqual(member);

    close();
  });

  it('creates, fetches, and lists policies with service rules', async () => {
    const { db, close } = createDb();
    const memberRepository = new SqliteMemberRepository(db);
    const policyRepository = new SqlitePolicyRepository(db);

    await memberRepository.create({
      memberId: 'MEM-0001',
      fullName: 'Aarav Mehta',
      dateOfBirth: '1988-07-14'
    });

    const policy: Policy = {
      policyId: 'POL-0001',
      memberId: 'MEM-0001',
      policyType: 'Health PPO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 500,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 3000,
        serviceRules: [
          { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 },
          { serviceCode: 'prescription', covered: false, yearlyDollarCap: null, yearlyVisitCap: null }
        ]
      }
    };

    await policyRepository.create(policy);

    await expect(policyRepository.getById(policy.policyId)).resolves.toEqual(policy);
    await expect(policyRepository.listByMemberId(policy.memberId)).resolves.toEqual([policy]);

    close();
  });

  it('creates, fetches, and updates a claim with line items and decisions', async () => {
    const { db, close } = createDb();
    const memberRepository = new SqliteMemberRepository(db);
    const policyRepository = new SqlitePolicyRepository(db);
    const claimRepository = new SqliteClaimRepository(db);

    await memberRepository.create({
      memberId: 'MEM-0001',
      fullName: 'Aarav Mehta',
      dateOfBirth: '1988-07-14'
    });

    await policyRepository.create({
      policyId: 'POL-0001',
      memberId: 'MEM-0001',
      policyType: 'Health PPO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 0,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 3000,
        serviceRules: [{ serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 }]
      }
    });

    const claim: Claim = {
      claimId: 'CLM-0001',
      memberId: 'MEM-0001',
      policyId: 'POL-0001',
      provider: { providerId: 'PRV-0001', name: 'CityCare Clinic' },
      dateOfService: '2026-02-01',
      diagnosisCodes: ['J02.9'],
      status: 'submitted',
      approvedLineItemCount: 0,
      lineItems: [
        {
          lineItemId: 'LI-0001',
          serviceCode: 'office_visit',
          description: 'Primary care consultation',
          billedAmount: 150,
          status: 'submitted'
        }
      ],
      lineDecisions: []
    };

    await claimRepository.create(claim);
    await expect(claimRepository.getById(claim.claimId)).resolves.toEqual(claim);

    const updatedClaim: Claim = {
      ...claim,
      status: 'approved',
      approvedLineItemCount: 1,
      lineItems: [{ ...claim.lineItems[0]!, status: 'approved' }],
      lineDecisions: [
        {
          lineItemId: 'LI-0001',
          decision: 'approved',
          reasonCode: null,
          reasonText: null,
          memberNextStep: null,
          payerAmount: 120,
          memberResponsibility: 30
        }
      ]
    };

    await claimRepository.update(updatedClaim);
    await expect(claimRepository.getById(updatedClaim.claimId)).resolves.toEqual(updatedClaim);
    await expect(claimRepository.listByMemberId(updatedClaim.memberId)).resolves.toEqual([updatedClaim]);

    close();
  });

  it('creates, fetches, and lists disputes', async () => {
    const { db, close } = createDb();
    const memberRepository = new SqliteMemberRepository(db);
    const policyRepository = new SqlitePolicyRepository(db);
    const claimRepository = new SqliteClaimRepository(db);
    const disputeRepository = new SqliteDisputeRepository(db);

    await memberRepository.create({
      memberId: 'MEM-0001',
      fullName: 'Aarav Mehta',
      dateOfBirth: '1988-07-14'
    });

    await policyRepository.create({
      policyId: 'POL-0001',
      memberId: 'MEM-0001',
      policyType: 'Health PPO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 0,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 3000,
        serviceRules: [{ serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 }]
      }
    });

    await claimRepository.create({
      claimId: 'CLM-0001',
      memberId: 'MEM-0001',
      policyId: 'POL-0001',
      provider: { providerId: 'PRV-0001', name: 'CityCare Clinic' },
      dateOfService: '2026-02-01',
      diagnosisCodes: ['J02.9'],
      status: 'approved',
      approvedLineItemCount: 1,
      lineItems: [
        {
          lineItemId: 'LI-0001',
          serviceCode: 'office_visit',
          description: 'Primary care consultation',
          billedAmount: 150,
          status: 'approved'
        }
      ],
      lineDecisions: []
    });

    const dispute: Dispute = {
      disputeId: 'DSP-0001',
      claimId: 'CLM-0001',
      memberId: 'MEM-0001',
      status: 'open',
      reason: 'Incorrect denial',
      note: 'Please review this service again.',
      referencedLineItemIds: ['LI-0001'],
      resolvedAt: null,
      resolutionNote: null
    };

    await disputeRepository.create(dispute);

    await expect(disputeRepository.getById(dispute.disputeId)).resolves.toEqual(dispute);
    await expect(disputeRepository.listByClaimId(dispute.claimId)).resolves.toEqual([dispute]);

    close();
  });

  it('appends and lists accumulator entries', async () => {
    const { db, close } = createDb();
    const memberRepository = new SqliteMemberRepository(db);
    const policyRepository = new SqlitePolicyRepository(db);
    const accumulatorRepository = new SqliteAccumulatorRepository(db);

    await memberRepository.create({
      memberId: 'MEM-0001',
      fullName: 'Aarav Mehta',
      dateOfBirth: '1988-07-14'
    });

    await policyRepository.create({
      policyId: 'POL-0001',
      memberId: 'MEM-0001',
      policyType: 'Health PPO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 0,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 3000,
        serviceRules: [{ serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 }]
      }
    });

    const entries: AccumulatorEntry[] = [
      {
        memberId: 'MEM-0001',
        policyId: 'POL-0001',
        serviceCode: 'office_visit',
        benefitPeriodStart: '2026-01-01',
        benefitPeriodEnd: '2026-12-31',
        metricType: 'dollars_paid',
        delta: 120,
        source: 'claim_line_item',
        sourceId: 'LI-0001',
        status: 'posted'
      },
      {
        memberId: 'MEM-0001',
        policyId: 'POL-0001',
        serviceCode: 'office_visit',
        benefitPeriodStart: '2026-01-01',
        benefitPeriodEnd: '2026-12-31',
        metricType: 'visits_used',
        delta: 1,
        source: 'claim_line_item',
        sourceId: 'LI-0001',
        status: 'posted'
      },
      {
        memberId: 'MEM-0001',
        policyId: 'POL-0001',
        serviceCode: 'office_visit',
        benefitPeriodStart: '2026-01-01',
        benefitPeriodEnd: '2026-12-31',
        metricType: 'member_oop_applied',
        delta: 30,
        source: 'claim_line_item',
        sourceId: 'LI-0001',
        status: 'posted'
      }
    ];

    await accumulatorRepository.append(entries[0]!);
    await accumulatorRepository.appendMany(entries.slice(1));

    await expect(accumulatorRepository.listByPolicyAndService('POL-0001', 'office_visit')).resolves.toEqual(
      expect.arrayContaining(entries)
    );
    await expect(accumulatorRepository.listByPolicy('POL-0001')).resolves.toEqual(expect.arrayContaining(entries));

    close();
  });
});
