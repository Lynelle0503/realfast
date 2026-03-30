import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

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
    expect(stdout.output).toContain('create member');
    expect(stdout.output).toContain('create policy <memberId>');
    expect(stdout.output).toContain('list claims <memberId>');
    expect(stdout.output).toContain('list disputes <claimId>');
    expect(stdout.output).toContain('show dispute <disputeId>');
    expect(stdout.output).toContain('show accumulator <policyId> <serviceCode>');
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
    expect(stdout.output).toContain('office_visit: covered=true');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['list', 'claims', 'MEM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Claim CLM-0001');
    expect(stdout.output).toContain('Approved line items: 3');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['show', 'claim', 'CLM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Claim CLM-0001');
    expect(stdout.output).toContain('Status: under_review');
    expect(stdout.output).toContain(
      'Status explanation: under_review because line item(s) LI-0005 are still in manual_review.'
    );
    expect(stdout.output).toContain(
      'Dispute status: 1 dispute(s) exist for this claim (DSP-0001). In v1, disputes do not automatically change claim status.'
    );
    expect(stdout.output).toContain('Approved line items: 3');
    expect(stdout.output).toContain('Reason: This service is not covered under your policy.');
    expect(stdout.output).toContain('Service rule: covered=false');
    expect(stdout.output).toContain('Why this line was denied: the matched service rule is not covered under this policy.');
    expect(stdout.output).toContain(
      'Reason: This service is still under review because it needs additional review before a final decision can be made.'
    );
    expect(stdout.output).toContain('Manual review detail: automatic adjudication would have paid 80.00');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['resolve', 'manual-review', 'CLM-0001', 'LI-0005', 'approved', '--db', dbPath], {
      stdout,
      stderr
    });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Resolved manual review for LI-0005 on claim CLM-0001.');
    expect(stdout.output).toContain('Status: approved');
    expect(stdout.output).toContain(
      'Status explanation: approved because every line item is resolved. 4 line item(s) were approved or paid and 1 were denied.'
    );
    expect(stdout.output).toContain('Approved line items: 4');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['pay', 'claim', 'CLM-0001', '--all-approved', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Recorded payment for claim CLM-0001.');
    expect(stdout.output).toContain('Status: paid');
    expect(stdout.output).toContain('Status explanation: paid because all approved line items have been marked as paid.');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(
      ['open', 'dispute', 'CLM-0001', '--db', dbPath, '--reason', 'Please review this denial.', '--line-item-id', 'LI-0004'],
      { stdout, stderr }
    );
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Opened dispute');
    expect(stdout.output).toContain('Dispute DSP-0002');
    expect(stdout.output).toContain('Referenced line items: LI-0004');
    expect(stdout.output).toContain('Next: run "npm run cli -- list disputes CLM-0001 --db');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['list', 'disputes', 'CLM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Dispute DSP-0001');
    expect(stdout.output).toContain('Dispute DSP-0002');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['show', 'dispute', 'DSP-0002', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Dispute DSP-0002');
    expect(stdout.output).toContain('Reason: Please review this denial.');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['show', 'accumulator', 'POL-0001', 'office_visit', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Accumulator for policy POL-0001 service office_visit');
    expect(stdout.output).toContain('Total dollars paid usage: 180.00');
    expect(stdout.output).toContain('Total visits used: 3');
    expect(stdout.output).toContain('Service rule summary: covered=true, yearlyDollarCap=180, yearlyVisitCap=10');
    expect(stdout.output).toContain('Remaining yearly dollar benefit: 0.00');
    expect(stdout.output).toContain('Remaining yearly visit benefit: 7');
  });

  it('creates members and policies, then submits claims from json files and flags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-cli-submit-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'claims.db');

    let stdout = createMemoryStream();
    let stderr = createMemoryStream();
    let exitCode: number;

    exitCode = await runCli(
      ['create', 'member', '--db', dbPath, '--full-name', 'Demo Member', '--date-of-birth', '1990-01-01'],
      { stdout, stderr }
    );
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Created member MEM-0001.');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(
      [
        'create',
        'policy',
        'MEM-0001',
        '--db',
        dbPath,
        '--policy-type',
        'Health PPO',
        '--effective-date',
        '2026-01-01',
        '--benefit-period',
        'policy_year',
        '--deductible',
        '0',
        '--coinsurance-percent',
        '80',
        '--annual-out-of-pocket-max',
        '3000',
        '--service-rule',
        'office_visit|true|1000|10'
      ],
      { stdout, stderr }
    );
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Created policy POL-0001.');
    expect(stdout.output).toContain('office_visit: covered=true');

    const jsonPath = join(dir, 'claim.json');
    writeFileSync(
      jsonPath,
      JSON.stringify({
        memberId: 'MEM-0001',
        policyId: 'POL-0001',
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
    expect(stdout.output).toContain('Status explanation: submitted because adjudication has not started yet.');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(['adjudicate', 'claim', 'CLM-0001', '--db', dbPath], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout.output).toContain('Adjudicated claim CLM-0001.');
    expect(stdout.output).toContain('Status explanation: approved because every line item is resolved and adjudication is complete.');
    expect(stdout.output).toContain('Accumulator effects from this adjudication:');
    expect(stdout.output).toContain('Service: office_visit');
    expect(stdout.output).toContain('Total dollars paid usage: 100.00');
    expect(stdout.output).toContain('Total visits used: 1');
    expect(stdout.output).toContain('Remaining yearly dollar benefit: 900.00');

    stdout = createMemoryStream();
    stderr = createMemoryStream();
    exitCode = await runCli(
      [
        'submit',
        'claim',
        '--db',
        dbPath,
        '--member-id',
        'MEM-0001',
        '--policy-id',
        'POL-0001',
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
