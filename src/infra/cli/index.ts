#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { adjudicateClaimCommand } from '../../core/application/commands/adjudicate-claim.js';
import { createClaim } from '../../core/application/commands/create-claim.js';
import { markClaimPayment } from '../../core/application/commands/mark-claim-payment.js';
import { openDispute } from '../../core/application/commands/open-dispute.js';
import { resolveManualReviewCommand } from '../../core/application/commands/resolve-manual-review.js';
import { ApplicationError } from '../../core/application/errors/application-error.js';
import { BusinessRuleError } from '../../core/application/errors/business-rule-error.js';
import { NotFoundError } from '../../core/application/errors/not-found-error.js';
import { ValidationError } from '../../core/application/errors/validation-error.js';
import { getClaim } from '../../core/application/queries/get-claim.js';
import { getMember } from '../../core/application/queries/get-member.js';
import { listMemberPolicies } from '../../core/application/queries/list-member-policies.js';
import type { Claim, LineDecision } from '../../core/domain/claim.js';
import { seedDatabase } from '../db/seed.js';
import { DEFAULT_DB_PATH } from '../db/sqlite.js';
import { createSqliteAppContext } from '../app/context.js';

interface CliEnvironment {
  stdout: { write(message: string): void };
  stderr: { write(message: string): void };
}

interface ParsedArguments {
  commandKey: string | null;
  positionals: string[];
  values: Map<string, string[]>;
  booleans: Set<string>;
}

function writeLine(stream: CliEnvironment['stdout'] | CliEnvironment['stderr'], text = ''): void {
  stream.write(`${text}\n`);
}

function formatMoney(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  return value.toFixed(2);
}

function findDecision(claim: Claim, lineItemId: string): LineDecision | undefined {
  return claim.lineDecisions.find((lineDecision) => lineDecision.lineItemId === lineItemId);
}

function formatClaim(claim: Claim): string {
  const lines: string[] = [
    `Claim ${claim.claimId}`,
    `Status: ${claim.status}`,
    `Approved line items: ${claim.approvedLineItemCount}`,
    `Member: ${claim.memberId}`,
    `Policy: ${claim.policyId}`,
    `Provider: ${claim.provider.name} (${claim.provider.providerId})`,
    `Diagnosis codes: ${claim.diagnosisCodes.length > 0 ? claim.diagnosisCodes.join(', ') : 'none'}`,
    'Line items:'
  ];

  claim.lineItems.forEach((lineItem) => {
    const decision = findDecision(claim, lineItem.lineItemId);
    lines.push(`- ${lineItem.lineItemId} ${lineItem.serviceCode}: ${lineItem.description}`);
    lines.push(`  State: ${lineItem.status}`);
    lines.push(`  Billed amount: ${lineItem.billedAmount.toFixed(2)}`);
    lines.push(`  Payer amount: ${formatMoney(decision?.payerAmount ?? null)}`);
    lines.push(`  Member responsibility: ${formatMoney(decision?.memberResponsibility ?? null)}`);
    lines.push(`  Reason: ${decision?.reasonText ?? 'n/a'}`);
    lines.push(`  Next step: ${decision?.memberNextStep ?? 'n/a'}`);
  });

  return lines.join('\n');
}

function getFlagValue(parsed: ParsedArguments, name: string): string | undefined {
  return parsed.values.get(name)?.[0];
}

function getFlagValues(parsed: ParsedArguments, name: string): string[] {
  return parsed.values.get(name) ?? [];
}

function requireFlagValue(parsed: ParsedArguments, name: string, label: string): string {
  const value = getFlagValue(parsed, name);
  if (!value) {
    throw new ValidationError(`${label} is required.`);
  }

  return value;
}

function parseArguments(argv: string[]): ParsedArguments {
  const values = new Map<string, string[]>();
  const booleans = new Set<string>();
  const positionals: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        booleans.add(name);
        index += 1;
        continue;
      }

      values.set(name, [...(values.get(name) ?? []), next]);
      index += 2;
      continue;
    }

    positionals.push(token);
    index += 1;
  }

  let commandKey: string | null = null;
  let commandLength = 0;

  const first = positionals[0];
  const second = positionals[1];

  if (first === 'help') {
    commandKey = 'help';
    commandLength = 1;
  } else if (first && second) {
    const pair = `${first} ${second}`;
    const multiWordCommands = new Set([
      'seed demo-data',
      'show member',
      'list policies',
      'submit claim',
      'adjudicate claim',
      'resolve manual-review',
      'pay claim',
      'open dispute',
      'show claim'
    ]);

    if (multiWordCommands.has(pair)) {
      commandKey = pair;
      commandLength = 2;
    }
  }

  if (!commandKey && first) {
    commandKey = first;
    commandLength = 1;
  }

  return {
    commandKey,
    positionals: positionals.slice(commandLength),
    values,
    booleans
  };
}

function renderHelp(): string {
  return [
    'Claims CLI',
    '',
    'Usage:',
    '  npm run cli -- <command> [arguments] [--flags]',
    '',
    'Commands:',
    '  seed demo-data [--db PATH]',
    '  show member <memberId> [--db PATH]',
    '  list policies <memberId> [--db PATH]',
    '  submit claim [--db PATH] --json FILE',
    '  submit claim [--db PATH] --member-id ID --policy-id ID --provider-id ID --provider-name NAME [--diagnosis-code CODE]... --line-item "serviceCode|description|billedAmount" [--line-item ...]',
    '  adjudicate claim <claimId> [--db PATH]',
    '  resolve manual-review <claimId> <lineItemId> <approved|denied> [--db PATH]',
    '  pay claim <claimId> [--db PATH] --line-item-id ID [--line-item-id ...]',
    '  pay claim <claimId> [--db PATH] --all-approved',
    '  open dispute <claimId> [--db PATH] --reason TEXT [--note TEXT] [--line-item-id ID]...',
    '  show claim <claimId> [--db PATH]',
    '  help',
    '',
    'Examples:',
    `  npm run cli -- seed demo-data --db ${DEFAULT_DB_PATH}`,
    '  npm run cli -- show member MEM-0001',
    '  npm run cli -- list policies MEM-0001',
    '  npm run cli -- submit claim --json ./claim.json',
    '  npm run cli -- submit claim --member-id MEM-0001 --policy-id POL-0001 --provider-id PRV-9001 --provider-name "CityCare Clinic" --diagnosis-code J02.9 --line-item "office_visit|Primary care consultation|150"',
    '  npm run cli -- adjudicate claim CLM-0001',
    '  npm run cli -- resolve manual-review CLM-0001 LI-0005 approved',
    '  npm run cli -- pay claim CLM-0001 --all-approved',
    '  npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --line-item-id LI-0004',
    '  npm run cli -- show claim CLM-0001'
  ].join('\n');
}

function getDbPath(parsed: ParsedArguments): string | undefined {
  return getFlagValue(parsed, 'db');
}

function parseLineItemFlag(value: string): { serviceCode: string; description: string; billedAmount: number } {
  const [serviceCode, description, billedAmountText, ...rest] = value.split('|');
  if (!serviceCode || !description || !billedAmountText || rest.length > 0) {
    throw new ValidationError('Each --line-item value must use "serviceCode|description|billedAmount".');
  }

  const billedAmount = Number(billedAmountText);
  if (Number.isNaN(billedAmount)) {
    throw new ValidationError('Each --line-item billed amount must be numeric.');
  }

  return {
    serviceCode,
    description,
    billedAmount
  };
}

function parseClaimRequestFromFlags(parsed: ParsedArguments) {
  return {
    memberId: requireFlagValue(parsed, 'member-id', 'member-id'),
    policyId: requireFlagValue(parsed, 'policy-id', 'policy-id'),
    provider: {
      providerId: requireFlagValue(parsed, 'provider-id', 'provider-id'),
      name: requireFlagValue(parsed, 'provider-name', 'provider-name')
    },
    diagnosisCodes: getFlagValues(parsed, 'diagnosis-code'),
    lineItems: getFlagValues(parsed, 'line-item').map(parseLineItemFlag)
  };
}

function parseClaimRequestFromJsonFile(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as {
      memberId: string;
      policyId: string;
      provider: { providerId: string; name: string };
      diagnosisCodes: string[];
      lineItems: Array<{ serviceCode: string; description: string; billedAmount: number }>;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ValidationError(`Unable to read claim JSON from ${filePath}: ${message}`);
  }
}

export async function runCli(argv: string[], environment: CliEnvironment = process): Promise<number> {
  const parsed = parseArguments(argv);

  if (parsed.booleans.has('help') || !parsed.commandKey || parsed.commandKey === 'help') {
    writeLine(environment.stdout, renderHelp());
    return 0;
  }

  if (parsed.commandKey === 'seed demo-data') {
    const summary = await seedDatabase({ filePath: getDbPath(parsed) ?? DEFAULT_DB_PATH });
    writeLine(
      environment.stdout,
      `Seeded demo data at ${summary.filePath} (${summary.members} members, ${summary.policies} policies, ${summary.claims} claims, ${summary.disputes} disputes, ${summary.accumulatorEntries} accumulator entries).`
    );
    return 0;
  }

  const dbPath = getDbPath(parsed);
  const context = createSqliteAppContext(dbPath ? { filePath: dbPath } : {});

  try {
    if (parsed.commandKey === 'show member') {
      const memberId = parsed.positionals[0];
      if (!memberId) {
        throw new ValidationError('memberId is required.');
      }

      const member = await getMember(context.memberRepository, memberId);
      writeLine(environment.stdout, `Member ${member.memberId}`);
      writeLine(environment.stdout, `Full name: ${member.fullName}`);
      writeLine(environment.stdout, `Date of birth: ${member.dateOfBirth}`);
      return 0;
    }

    if (parsed.commandKey === 'list policies') {
      const memberId = parsed.positionals[0];
      if (!memberId) {
        throw new ValidationError('memberId is required.');
      }

      const policies = await listMemberPolicies(context.policyRepository, memberId);
      if (policies.length === 0) {
        writeLine(environment.stdout, `No policies found for member ${memberId}.`);
        return 0;
      }

      policies.forEach((policy) => {
        writeLine(environment.stdout, `Policy ${policy.policyId}`);
        writeLine(environment.stdout, `  Type: ${policy.policyType}`);
        writeLine(environment.stdout, `  Effective date: ${policy.effectiveDate}`);
        writeLine(environment.stdout, `  Service rules: ${policy.coverageRules.serviceRules.length}`);
      });
      return 0;
    }

    if (parsed.commandKey === 'submit claim') {
      const jsonPath = getFlagValue(parsed, 'json');
      const input = jsonPath ? parseClaimRequestFromJsonFile(jsonPath) : parseClaimRequestFromFlags(parsed);
      const claim = await createClaim(
        {
          memberRepository: context.memberRepository,
          policyRepository: context.policyRepository,
          claimRepository: context.claimRepository,
          idGenerator: context.idGenerator
        },
        input
      );

      writeLine(environment.stdout, `Created claim ${claim.claimId}.`);
      writeLine(environment.stdout, formatClaim(claim));
      return 0;
    }

    if (parsed.commandKey === 'adjudicate claim') {
      const claimId = parsed.positionals[0];
      if (!claimId) {
        throw new ValidationError('claimId is required.');
      }

      const result = await adjudicateClaimCommand(
        {
          claimRepository: context.claimRepository,
          policyRepository: context.policyRepository,
          accumulatorRepository: context.accumulatorRepository,
          clock: context.clock
        },
        claimId
      );

      writeLine(environment.stdout, `Adjudicated claim ${claimId}.`);
      writeLine(environment.stdout, formatClaim(result.claim));
      return 0;
    }

    if (parsed.commandKey === 'resolve manual-review') {
      const [claimId, lineItemId, decision] = parsed.positionals;
      if (!claimId || !lineItemId || (decision !== 'approved' && decision !== 'denied')) {
        throw new ValidationError('Usage: resolve manual-review <claimId> <lineItemId> <approved|denied>');
      }

      const result = await resolveManualReviewCommand(
        {
          claimRepository: context.claimRepository,
          policyRepository: context.policyRepository,
          accumulatorRepository: context.accumulatorRepository,
          clock: context.clock
        },
        { claimId, lineItemId, decision }
      );

      writeLine(environment.stdout, `Resolved manual review for ${lineItemId} on claim ${claimId}.`);
      writeLine(environment.stdout, formatClaim(result.claim));
      return 0;
    }

    if (parsed.commandKey === 'pay claim') {
      const claimId = parsed.positionals[0];
      if (!claimId) {
        throw new ValidationError('claimId is required.');
      }

      let lineItemIds = getFlagValues(parsed, 'line-item-id');
      if (parsed.booleans.has('all-approved')) {
        const claim = await getClaim(context.claimRepository, claimId);
        lineItemIds = claim.lineItems
          .filter((lineItem) => lineItem.status === 'approved')
          .map((lineItem) => lineItem.lineItemId);
      }

      if (lineItemIds.length === 0) {
        throw new ValidationError('Provide at least one --line-item-id or use --all-approved.');
      }

      const result = await markClaimPayment({ claimRepository: context.claimRepository }, { claimId, lineItemIds });
      writeLine(environment.stdout, `Recorded payment for claim ${claimId}.`);
      writeLine(environment.stdout, formatClaim(result.claim));
      return 0;
    }

    if (parsed.commandKey === 'open dispute') {
      const claimId = parsed.positionals[0];
      if (!claimId) {
        throw new ValidationError('claimId is required.');
      }

      const disputeInput: {
        claimId: string;
        reason: string;
        note?: string;
        referencedLineItemIds?: string[];
      } = {
        claimId,
        reason: requireFlagValue(parsed, 'reason', 'reason')
      };

      const note = getFlagValue(parsed, 'note');
      if (note !== undefined) {
        disputeInput.note = note;
      }

      const referencedLineItemIds = getFlagValues(parsed, 'line-item-id');
      if (referencedLineItemIds.length > 0) {
        disputeInput.referencedLineItemIds = referencedLineItemIds;
      }

      const dispute = await openDispute(
        {
          claimRepository: context.claimRepository,
          disputeRepository: context.disputeRepository,
          idGenerator: context.idGenerator
        },
        disputeInput
      );

      writeLine(environment.stdout, `Opened dispute ${dispute.disputeId}.`);
      writeLine(environment.stdout, `Claim: ${dispute.claimId}`);
      writeLine(environment.stdout, `Member: ${dispute.memberId}`);
      writeLine(environment.stdout, `Status: ${dispute.status}`);
      writeLine(environment.stdout, `Reason: ${dispute.reason}`);
      writeLine(environment.stdout, `Note: ${dispute.note ?? 'n/a'}`);
      writeLine(
        environment.stdout,
        `Referenced line items: ${dispute.referencedLineItemIds.length > 0 ? dispute.referencedLineItemIds.join(', ') : 'none'}`
      );
      return 0;
    }

    if (parsed.commandKey === 'show claim') {
      const claimId = parsed.positionals[0];
      if (!claimId) {
        throw new ValidationError('claimId is required.');
      }

      const claim = await getClaim(context.claimRepository, claimId);
      writeLine(environment.stdout, formatClaim(claim));
      return 0;
    }

    throw new ValidationError(`Unknown command: ${parsed.commandKey}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof BusinessRuleError ||
      error instanceof ApplicationError
    ) {
      writeLine(environment.stderr, `Error: ${message}`);
      return 1;
    }

    writeLine(environment.stderr, `Unexpected error: ${message}`);
    return 1;
  } finally {
    context.close();
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}

const executedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (executedDirectly) {
  void main();
}
