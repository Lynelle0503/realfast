import Database from 'better-sqlite3';
import { pathToFileURL } from 'node:url';

import { adjudicateClaimCommand } from '../../core/application/commands/adjudicate-claim.js';
import { createClaim } from '../../core/application/commands/create-claim.js';
import { createMember } from '../../core/application/commands/create-member.js';
import { createPolicy } from '../../core/application/commands/create-policy.js';
import { markClaimPayment } from '../../core/application/commands/mark-claim-payment.js';
import { openDispute } from '../../core/application/commands/open-dispute.js';
import { SystemClock } from './support/clock.js';
import { DeterministicIdGenerator } from './support/ids.js';
import { SqliteAccumulatorRepository } from './repositories/sqlite-accumulator-repository.js';
import { SqliteClaimRepository } from './repositories/sqlite-claim-repository.js';
import { SqliteDisputeRepository } from './repositories/sqlite-dispute-repository.js';
import { SqliteMemberRepository } from './repositories/sqlite-member-repository.js';
import { SqlitePolicyRepository } from './repositories/sqlite-policy-repository.js';
import { DEFAULT_DB_PATH, closeDatabase, recreateDatabase, type SqliteDatabaseOptions } from './sqlite.js';

export interface SeedSummary {
  filePath: string;
  members: number;
  policies: number;
  claims: number;
  disputes: number;
  accumulatorEntries: number;
}

class FixedClock extends SystemClock {
  constructor(private readonly value: Date) {
    super();
  }

  override now(): Date {
    return this.value;
  }
}

function countRows(db: Database.Database, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

export async function seedDatabase(options: SqliteDatabaseOptions = {}): Promise<SeedSummary> {
  const filePath = options.filePath ?? DEFAULT_DB_PATH;
  const db = recreateDatabase({ filePath });

  try {
    await populateSeedData(db);

    return {
      filePath,
      members: countRows(db, 'members'),
      policies: countRows(db, 'policies'),
      claims: countRows(db, 'claims'),
      disputes: countRows(db, 'disputes'),
      accumulatorEntries: countRows(db, 'accumulator_entries')
    };
  } finally {
    closeDatabase(db);
  }
}

async function populateSeedData(db: Database.Database): Promise<void> {
  const memberRepository = new SqliteMemberRepository(db);
  const policyRepository = new SqlitePolicyRepository(db);
  const claimRepository = new SqliteClaimRepository(db);
  const disputeRepository = new SqliteDisputeRepository(db);
  const accumulatorRepository = new SqliteAccumulatorRepository(db);
  const idGenerator = new DeterministicIdGenerator();
  const adjudicationClock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));

  const member1 = await createMember(
    { memberRepository, idGenerator },
    { fullName: 'Aarav Mehta', dateOfBirth: '1988-07-14' }
  );
  const policy1 = await createPolicy(
    { memberRepository, policyRepository, idGenerator },
    {
      memberId: member1.memberId,
      policyType: 'Health PPO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 0,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 3000,
        serviceRules: [
          { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 180, yearlyVisitCap: 10 },
          { serviceCode: 'lab_test', covered: true, yearlyDollarCap: 500, yearlyVisitCap: null },
          { serviceCode: 'therapy_session', covered: true, yearlyDollarCap: 800, yearlyVisitCap: 5 },
          { serviceCode: 'prescription', covered: false, yearlyDollarCap: null, yearlyVisitCap: null },
          { serviceCode: 'imaging', covered: true, yearlyDollarCap: 200, yearlyVisitCap: null }
        ]
      }
    }
  );

  await accumulatorRepository.appendMany([
    {
      memberId: member1.memberId,
      policyId: policy1.policyId,
      serviceCode: 'office_visit',
      benefitPeriodStart: '2026-01-01',
      benefitPeriodEnd: '2026-12-31',
      metricType: 'dollars_paid',
      delta: 20,
      source: 'claim_line_item',
      sourceId: 'HIST-LI-0001',
      status: 'posted'
    },
    {
      memberId: member1.memberId,
      policyId: policy1.policyId,
      serviceCode: 'office_visit',
      benefitPeriodStart: '2026-01-01',
      benefitPeriodEnd: '2026-12-31',
      metricType: 'visits_used',
      delta: 1,
      source: 'claim_line_item',
      sourceId: 'HIST-LI-0001',
      status: 'posted'
    },
    {
      memberId: member1.memberId,
      policyId: policy1.policyId,
      serviceCode: 'imaging',
      benefitPeriodStart: '2026-01-01',
      benefitPeriodEnd: '2026-12-31',
      metricType: 'dollars_paid',
      delta: 200,
      source: 'claim_line_item',
      sourceId: 'HIST-LI-0002',
      status: 'posted'
    },
    {
      memberId: member1.memberId,
      policyId: policy1.policyId,
      serviceCode: 'imaging',
      benefitPeriodStart: '2026-01-01',
      benefitPeriodEnd: '2026-12-31',
      metricType: 'visits_used',
      delta: 1,
      source: 'claim_line_item',
      sourceId: 'HIST-LI-0002',
      status: 'posted'
    }
  ]);

  const claim1 = await createClaim(
    { memberRepository, policyRepository, claimRepository, idGenerator },
    {
      memberId: member1.memberId,
      policyId: policy1.policyId,
      provider: { providerId: 'PRV-0501', name: 'CityCare Clinic' },
      diagnosisCodes: ['J02.9'],
      lineItems: [
        { serviceCode: 'office_visit', description: 'Primary care consultation', billedAmount: 150 },
        { serviceCode: 'lab_test', description: 'Rapid strep test', billedAmount: 80 },
        { serviceCode: 'therapy_session', description: 'Physical therapy session', billedAmount: 200 },
        { serviceCode: 'prescription', description: 'Antibiotic prescription', billedAmount: 50 },
        { serviceCode: 'office_visit', description: 'Follow-up office visit', billedAmount: 100 }
      ]
    }
  );

  const adjudicatedClaim1 = await adjudicateClaimCommand(
    { claimRepository, policyRepository, accumulatorRepository, clock: adjudicationClock },
    claim1.claimId
  );

  const deniedLine = adjudicatedClaim1.claim.lineItems.find((lineItem) => lineItem.status === 'denied');
  if (!deniedLine) {
    throw new Error('Seeded mixed claim must include a denied line item.');
  }

  await openDispute(
    { claimRepository, disputeRepository, idGenerator },
    {
      claimId: claim1.claimId,
      memberId: member1.memberId,
      reason: 'I believe the denied line should be reconsidered.',
      note: 'Please review the service coverage details for this line.',
      referencedLineItemIds: [deniedLine.lineItemId]
    }
  );

  const member2 = await createMember(
    { memberRepository, idGenerator },
    { fullName: 'Maya Rao', dateOfBirth: '1991-11-03' }
  );
  const policy2 = await createPolicy(
    { memberRepository, policyRepository, idGenerator },
    {
      memberId: member2.memberId,
      policyType: 'Health HMO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 0,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 2500,
        serviceRules: [
          { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 12 },
          { serviceCode: 'lab_test', covered: true, yearlyDollarCap: 600, yearlyVisitCap: null }
        ]
      }
    }
  );

  const claim2 = await createClaim(
    { memberRepository, policyRepository, claimRepository, idGenerator },
    {
      memberId: member2.memberId,
      policyId: policy2.policyId,
      provider: { providerId: 'PRV-0502', name: 'Northside Medical' },
      diagnosisCodes: ['R50.9'],
      lineItems: [
        { serviceCode: 'office_visit', description: 'Urgent care visit', billedAmount: 120 },
        { serviceCode: 'lab_test', description: 'Blood panel', billedAmount: 90 }
      ]
    }
  );

  await adjudicateClaimCommand(
    { claimRepository, policyRepository, accumulatorRepository, clock: adjudicationClock },
    claim2.claimId
  );

  const member3 = await createMember(
    { memberRepository, idGenerator },
    { fullName: 'Riya Shah', dateOfBirth: '1985-05-22' }
  );
  const policy3 = await createPolicy(
    { memberRepository, policyRepository, idGenerator },
    {
      memberId: member3.memberId,
      policyType: 'Health PPO',
      effectiveDate: '2026-01-01',
      coverageRules: {
        benefitPeriod: 'policy_year',
        deductible: 0,
        coinsurancePercent: 80,
        annualOutOfPocketMax: 3500,
        serviceRules: [
          { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 12 },
          { serviceCode: 'therapy_session', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 8 }
        ]
      }
    }
  );

  const claim3 = await createClaim(
    { memberRepository, policyRepository, claimRepository, idGenerator },
    {
      memberId: member3.memberId,
      policyId: policy3.policyId,
      provider: { providerId: 'PRV-0503', name: 'Lakeside Rehab' },
      diagnosisCodes: ['M54.5'],
      lineItems: [
        { serviceCode: 'office_visit', description: 'Initial specialist visit', billedAmount: 140 },
        { serviceCode: 'therapy_session', description: 'Rehab session', billedAmount: 180 }
      ]
    }
  );

  const adjudicatedClaim3 = await adjudicateClaimCommand(
    { claimRepository, policyRepository, accumulatorRepository, clock: adjudicationClock },
    claim3.claimId
  );

  await markClaimPayment(
    { claimRepository },
    {
      claimId: claim3.claimId,
      lineItemIds: adjudicatedClaim3.claim.lineItems.map((lineItem) => lineItem.lineItemId)
    }
  );
}

async function main(): Promise<void> {
  const filePath = process.argv[2] ?? DEFAULT_DB_PATH;
  const summary = await seedDatabase({ filePath });

  console.log(
    `Seeded SQLite demo data at ${summary.filePath} (${summary.members} members, ${summary.policies} policies, ${summary.claims} claims, ${summary.disputes} disputes, ${summary.accumulatorEntries} accumulator entries).`
  );
}

const executedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (executedDirectly) {
  void main();
}
