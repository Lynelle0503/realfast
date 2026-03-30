import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createMember } from '../../src/core/application/commands/create-member.js';
import { createPolicy } from '../../src/core/application/commands/create-policy.js';
import { createSqliteAppContext } from '../../src/infra/app/context.js';
import { runCli } from '../../src/infra/cli/index.js';

interface MemoryStream {
  output: string;
  write(message: string): void;
}

function createMemoryStream(): MemoryStream {
  return {
    output: '',
    write(message: string) {
      this.output += message;
    }
  };
}

describe('cli', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('prints built-in help', async () => {
    const stdout = createMemoryStream();
    const stderr = createMemoryStream();

    const exitCode = await runCli(['help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Claims CLI');
    expect(stdout.output).toContain('seed demo-data');
    expect(stdout.output).toContain('show claim <claimId>');
    expect(stderr.output).toBe('');
  });

  it('runs the core demo workflows directly against the application layer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-cli-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'claims.db');

    let stdout = createMemoryStream();
    let stderr = createMemoryStream();
    let exitCode: number;

    exitCode = await runCli(['seed', 'demo-data', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Seeded demo data');
    expect(stderr.output).toBe('');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['show', 'member', 'MEM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Member MEM-0001');
    expect(stdout.output).toContain('Full name: Aarav Mehta');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['list', 'policies', 'MEM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Policy POL-0001');
    expect(stdout.output).toContain('Type: Health PPO');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['show', 'claim', 'CLM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Claim CLM-0001');
    expect(stdout.output).toContain('Status: under_review');
    expect(stdout.output).toContain('Approved line items: 3');
    expect(stdout.output).toContain('Reason: This service is not covered under your policy.');
    expect(stdout.output).toContain('Reason: This service is still under review because it needs additional review before a final decision can be made.');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['resolve', 'manual-review', 'CLM-0001', 'LI-0005', 'approved', '--db', dbPath], {
      stdout,
      stderr
    });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Resolved manual review for LI-0005 on claim CLM-0001.');
    expect(stdout.output).toContain('Status: approved');
    expect(stdout.output).toContain('Approved line items: 4');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['pay', 'claim', 'CLM-0001', '--all-approved', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Recorded payment for claim CLM-0001.');
    expect(stdout.output).toContain('Status: paid');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(
      ['open', 'dispute', 'CLM-0001', '--db', dbPath, '--reason', 'Please review this denial.', '--line-item-id', 'LI-0004'],
      { stdout, stderr }
    );
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Opened dispute');
    expect(stdout.output).toContain('Referenced line items: LI-0004');
  });

  it('submits claims from json files and flags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-cli-submit-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'claims.db');

    const appContext = createSqliteAppContext({ filePath: dbPath });
    const member = await createMember(
      { memberRepository: appContext.memberRepository, idGenerator: appContext.idGenerator },
      { fullName: 'Demo Member', dateOfBirth: '1990-01-01' }
    );
    const policy = await createPolicy(
      {
        memberRepository: appContext.memberRepository,
        policyRepository: appContext.policyRepository,
        idGenerator: appContext.idGenerator
      },
      {
        memberId: member.memberId,
        policyType: 'Health PPO',
        effectiveDate: '2026-01-01',
        coverageRules: {
          benefitPeriod: 'policy_year',
          deductible: 0,
          coinsurancePercent: 80,
          annualOutOfPocketMax: 3000,
          serviceRules: [{ serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 }]
        }
      }
    );
    appContext.close();

    let stdout = createMemoryStream();
    let stderr = createMemoryStream();
    let exitCode: number;

    const jsonPath = join(dir, 'claim.json');
    writeFileSync(
      jsonPath,
      JSON.stringify({
        memberId: member.memberId,
        policyId: policy.policyId,
        provider: { providerId: 'PRV-7777', name: 'Northside Medical' },
        diagnosisCodes: ['R50.9'],
        lineItems: [{ serviceCode: 'office_visit', description: 'Urgent care visit', billedAmount: 125 }]
      })
    );

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['submit', 'claim', '--db', dbPath, '--json', jsonPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Created claim CLM-0001.');
    expect(stdout.output).toContain('Status: submitted');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(
      [
        'submit',
        'claim',
        '--db',
        dbPath,
        '--member-id',
        member.memberId,
        '--policy-id',
        policy.policyId,
        '--provider-id',
        'PRV-9999',
        '--provider-name',
        'Downtown Clinic',
        '--diagnosis-code',
        'J01.9',
        '--line-item',
        'office_visit|Consultation|150'
      ],
      { stdout, stderr }
    );
    expect(exitCode).toBe(1);
    expect(stderr.output).toContain('Only one claim is allowed for a member on a particular policy.');
  });
});
