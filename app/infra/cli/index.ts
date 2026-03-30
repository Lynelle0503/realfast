#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { adjudicateClaimCommand } from '../../core/application/commands/adjudicate-claim.js';
import { createClaim } from '../../core/application/commands/create-claim.js';
import { createMember } from '../../core/application/commands/create-member.js';
import { createPolicy } from '../../core/application/commands/create-policy.js';
import { markClaimPayment } from '../../core/application/commands/mark-claim-payment.js';
import { openDispute } from '../../core/application/commands/open-dispute.js';
import { resolveDisputeCommand } from '../../core/application/commands/resolve-dispute.js';
import { resolveManualReviewCommand } from '../../core/application/commands/resolve-manual-review.js';
import { ApplicationError } from '../../core/application/errors/application-error.js';
import { BusinessRuleError } from '../../core/application/errors/business-rule-error.js';
import { NotFoundError } from '../../core/application/errors/not-found-error.js';
import { ValidationError } from '../../core/application/errors/validation-error.js';
import { getClaim } from '../../core/application/queries/get-claim.js';
import { getDispute } from '../../core/application/queries/get-dispute.js';
import { getMember } from '../../core/application/queries/get-member.js';
import { listClaimDisputes } from '../../core/application/queries/list-claim-disputes.js';
import { listMemberClaims } from '../../core/application/queries/list-member-claims.js';
import { listMemberPolicies } from '../../core/application/queries/list-member-policies.js';
import { getAccumulatorUsage } from '../../core/application/services/accumulator-service.js';
import { getBenefitPeriodWindow, getBenefitPeriodWindowForDate } from '../../core/application/services/benefit-period-service.js';
import type { AccumulatorEntry } from '../../core/domain/accumulator.js';
import type { Claim, LineDecision } from '../../core/domain/claim.js';
import type { Dispute } from '../../core/domain/dispute.js';
import type { CoverageRules, Policy } from '../../core/domain/policy.js';
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

interface ClaimFormattingContext {
  policy: Policy | null;
  periodStart: string | null;
  periodEnd: string | null;
  accumulatorEntriesByService: Map<string, AccumulatorEntry[]>;
  policyAccumulatorEntries: AccumulatorEntry[];
  disputes: Dispute[];
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

function getServiceDateForLineItem(claim: Claim, lineItem: Claim['lineItems'][number]): string | null {
  return lineItem.dateOfService ?? claim.dateOfService;
}

function getDeductibleAppliedForDecision(
  billedAmount: number,
  payerAmount: number | null,
  coinsurancePercent: number
): number {
  if (payerAmount === null) {
    return 0;
  }

  const coinsuranceFactor = coinsurancePercent / 100;
  if (coinsuranceFactor <= 0) {
    return billedAmount;
  }

  const deductibleApplied = billedAmount - payerAmount / coinsuranceFactor;
  return Math.max(0, Math.min(billedAmount, deductibleApplied));
}

function getRemainingDeductibleForClaim(claim: Claim, policy: Policy): number {
  return Math.max(0, policy.coverageRules.deductible);
}

function getRemainingDeductibleForPeriod(
  claim: Claim,
  policy: Policy,
  accumulatorEntries: AccumulatorEntry[],
  periodStart: string | null,
  periodEnd: string | null
): number {
  if (!periodStart || !periodEnd) {
    return getRemainingDeductibleForClaim(claim, policy);
  }

  const usage = getAccumulatorUsage(accumulatorEntries, periodStart, periodEnd);
  const deductibleSourceIds = new Set(
    accumulatorEntries
      .filter(
        (entry) =>
          entry.benefitPeriodStart === periodStart &&
          entry.benefitPeriodEnd === periodEnd &&
          entry.status === 'posted' &&
          entry.metricType === 'deductible_applied'
      )
      .map((entry) => entry.sourceId)
  );

  const fallbackApplied = claim.lineItems.reduce((sum, lineItem) => {
    if (lineItem.status !== 'approved' && lineItem.status !== 'paid') {
      return sum;
    }

    if (deductibleSourceIds.has(lineItem.lineItemId)) {
      return sum;
    }

    const decision = findDecision(claim, lineItem.lineItemId);
    if (!decision) {
      return sum;
    }

    return (
      sum +
      getDeductibleAppliedForDecision(lineItem.billedAmount, decision.payerAmount, policy.coverageRules.coinsurancePercent)
    );
  }, 0);

  return Math.max(0, policy.coverageRules.deductible - usage.deductibleApplied - fallbackApplied);
}

function formatServiceRule(policy: Policy | null, serviceCode: string): string {
  const serviceRule = policy?.coverageRules.serviceRules.find((rule) => rule.serviceCode === serviceCode);
  if (!serviceRule) {
    return 'Service rule: no matching service rule found on the policy.';
  }

  return `Service rule: covered=${serviceRule.covered}, yearlyDollarCap=${serviceRule.yearlyDollarCap ?? 'none'}, yearlyVisitCap=${serviceRule.yearlyVisitCap ?? 'none'}`;
}

function formatClaimStatusExplanation(claim: Claim): string {
  if (claim.status === 'submitted') {
    return 'Status explanation: submitted because adjudication has not started yet.';
  }

  const submittedIds = claim.lineItems.filter((lineItem) => lineItem.status === 'submitted').map((lineItem) => lineItem.lineItemId);
  const manualReviewIds = claim.lineItems
    .filter((lineItem) => lineItem.status === 'manual_review')
    .map((lineItem) => lineItem.lineItemId);
  const deniedCount = claim.lineItems.filter((lineItem) => lineItem.status === 'denied').length;
  const approvedOrPaidCount = claim.lineItems.filter(
    (lineItem) => lineItem.status === 'approved' || lineItem.status === 'paid'
  ).length;

  if (manualReviewIds.length > 0) {
    return `Status explanation: under_review because line item(s) ${manualReviewIds.join(', ')} are still in manual_review.`;
  }

  if (submittedIds.length > 0) {
    return `Status explanation: under_review because line item(s) ${submittedIds.join(', ')} are still submitted and unresolved.`;
  }

  if (
    claim.status === 'paid' &&
    claim.lineItems
      .filter((lineItem) => lineItem.status === 'approved' || lineItem.status === 'paid')
      .every((lineItem) => lineItem.status === 'paid')
  ) {
    return 'Status explanation: paid because all approved line items have been marked as paid.';
  }

  if (claim.status === 'approved' && deniedCount === claim.lineItems.length) {
    return 'Status explanation: approved because adjudication is complete and every line item is resolved, even though all line items were denied.';
  }

  if (claim.status === 'approved' && deniedCount > 0) {
    return `Status explanation: approved because every line item is resolved. ${approvedOrPaidCount} line item(s) were approved or paid and ${deniedCount} were denied.`;
  }

  if (claim.status === 'approved') {
    return 'Status explanation: approved because every line item is resolved and adjudication is complete.';
  }

  return `Status explanation: ${claim.status}.`;
}

function formatClaimDisputeExplanation(disputes: Dispute[]): string {
  if (disputes.length === 0) {
    return 'Dispute status: no disputes are currently open for this claim.';
  }

  const openCount = disputes.filter((dispute) => dispute.status === 'open').length;
  return `Dispute status: ${disputes.length} dispute(s) exist for this claim (${disputes
    .map((dispute) => `${dispute.disputeId}:${dispute.status}`)
    .join(', ')}). ${openCount} dispute(s) are still open.`;
}

function formatLineDecisionExplanation(
  claim: Claim,
  lineItem: Claim['lineItems'][number],
  decision: LineDecision | undefined,
  context: ClaimFormattingContext
): string[] {
  const lines: string[] = [];
  const serviceRule = context.policy?.coverageRules.serviceRules.find((rule) => rule.serviceCode === lineItem.serviceCode);
  const serviceEntries = context.accumulatorEntriesByService.get(lineItem.serviceCode) ?? [];
  const lineServiceDate = getServiceDateForLineItem(claim, lineItem);
  const linePeriod =
    context.policy && lineServiceDate ? getBenefitPeriodWindowForDate(context.policy.effectiveDate, lineServiceDate) : null;
  const usage =
    linePeriod
      ? getAccumulatorUsage(serviceEntries, linePeriod.start, linePeriod.end)
      : { usedDollars: 0, usedVisits: 0, memberOopApplied: 0, deductibleApplied: 0 };

  lines.push(`  ${formatServiceRule(context.policy, lineItem.serviceCode)}`);
  lines.push(`  Service date used: ${lineServiceDate ?? 'missing'}`);

  if (!decision) {
    lines.push('  Decision detail: no line decision has been recorded yet.');
    return lines;
  }

  if (decision.reasonCode === 'YEARLY_CAP_EXCEEDED' && serviceRule?.yearlyDollarCap !== null && serviceRule?.yearlyDollarCap !== undefined) {
    const remaining = Number((serviceRule.yearlyDollarCap - usage.usedDollars).toFixed(2));
    lines.push(
      `  Limit detail: yearly dollar cap=${serviceRule.yearlyDollarCap.toFixed(2)}, used=${usage.usedDollars.toFixed(2)}, remaining=${Math.max(0, remaining).toFixed(2)}.`
    );
    lines.push('  Why this line was denied: the yearly dollar cap for this service has already been exhausted.');
    return lines;
  }

  if (decision.reasonCode === 'VISIT_CAP_EXCEEDED' && serviceRule?.yearlyVisitCap !== null && serviceRule?.yearlyVisitCap !== undefined) {
    const remaining = serviceRule.yearlyVisitCap - usage.usedVisits;
    lines.push(
      `  Limit detail: yearly visit cap=${serviceRule.yearlyVisitCap}, used=${usage.usedVisits}, remaining=${Math.max(0, remaining)}.`
    );
    lines.push('  Why this line was denied: the yearly visit cap for this service has already been exhausted.');
    return lines;
  }

  if (decision.reasonCode === 'MANUAL_REVIEW_REQUIRED' && serviceRule?.yearlyDollarCap !== null && serviceRule?.yearlyDollarCap !== undefined && context.policy) {
    const remainingDeductible = getRemainingDeductibleForPeriod(
      claim,
      context.policy,
      context.policyAccumulatorEntries,
      linePeriod?.start ?? null,
      linePeriod?.end ?? null
    );
    const deductibleApplied = Math.min(lineItem.billedAmount, remainingDeductible);
    const coveredAmount = Math.max(0, lineItem.billedAmount - deductibleApplied);
    const standardPayerAmount = Number(
      ((coveredAmount * context.policy.coverageRules.coinsurancePercent) / 100).toFixed(2)
    );
    const remainingDollarCap = Number((serviceRule.yearlyDollarCap - usage.usedDollars).toFixed(2));
    lines.push(
      `  Limit detail: yearly dollar cap=${serviceRule.yearlyDollarCap.toFixed(2)}, used=${usage.usedDollars.toFixed(2)}, remaining=${Math.max(0, remainingDollarCap).toFixed(2)}.`
    );
    lines.push(
      `  Manual review detail: automatic adjudication would have paid ${standardPayerAmount.toFixed(2)}, but only ${Math.max(0, remainingDollarCap).toFixed(2)} remained under the cap, so the line was routed to manual review instead of auto-partially approving it.`
    );
    return lines;
  }

  if (decision.reasonCode === 'SERVICE_NOT_COVERED') {
    lines.push('  Why this line was denied: the matched service rule is not covered under this policy.');
    return lines;
  }

  if (decision.reasonCode === 'POLICY_NOT_ACTIVE') {
    lines.push('  Why this line was denied: the policy was not active for the service date used during adjudication.');
    return lines;
  }

  if (decision.reasonCode === 'MISSING_INFORMATION') {
    lines.push('  Why this line was denied: required claim information was missing, so the line could not be fully processed.');
    return lines;
  }

  if (decision.reasonCode === null && decision.decision === 'approved') {
    if (serviceRule?.yearlyDollarCap !== null && serviceRule?.yearlyDollarCap !== undefined) {
      lines.push(
        `  Cap usage after posting: yearly dollar cap=${serviceRule.yearlyDollarCap.toFixed(2)}, used=${usage.usedDollars.toFixed(2)}.`
      );
    }

    if (serviceRule?.yearlyVisitCap !== null && serviceRule?.yearlyVisitCap !== undefined) {
      lines.push(`  Visit usage after posting: yearly visit cap=${serviceRule.yearlyVisitCap}, used=${usage.usedVisits}.`);
    }
  }

  return lines;
}

async function buildClaimFormattingContext(
  claim: Claim,
  dependencies: {
    policyRepository: { getById(policyId: string): Promise<Policy | null> };
    accumulatorRepository: { listByPolicy(policyId: string): Promise<AccumulatorEntry[]> };
    disputeRepository: { listByClaimId(claimId: string): Promise<Dispute[]> };
  }
): Promise<ClaimFormattingContext> {
  const policy = await dependencies.policyRepository.getById(claim.policyId);
  const policyAccumulatorEntries = await dependencies.accumulatorRepository.listByPolicy(claim.policyId);
  const accumulatorEntriesByService = new Map<string, AccumulatorEntry[]>();
  [...new Set(claim.lineItems.map((lineItem) => lineItem.serviceCode))].forEach((serviceCode) => {
    accumulatorEntriesByService.set(
      serviceCode,
      policyAccumulatorEntries.filter((entry) => entry.serviceCode === serviceCode)
    );
  });

  const disputes = await dependencies.disputeRepository.listByClaimId(claim.claimId);

  if (!policy) {
    return {
      policy,
      periodStart: null,
      periodEnd: null,
      accumulatorEntriesByService,
      policyAccumulatorEntries,
      disputes
    };
  }

  const period = claim.dateOfService ? getBenefitPeriodWindowForDate(policy.effectiveDate, claim.dateOfService) : null;
  return {
    policy,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    accumulatorEntriesByService,
    policyAccumulatorEntries,
    disputes
  };
}

function formatClaim(claim: Claim, context: ClaimFormattingContext): string {
  const lines: string[] = [
    `Claim ${claim.claimId}`,
    `Status: ${claim.status}`,
    formatClaimStatusExplanation(claim),
    formatClaimDisputeExplanation(context.disputes),
    `Approved line items: ${claim.approvedLineItemCount}`,
    `Member: ${claim.memberId}`,
    `Policy: ${claim.policyId}`,
    `Service date: ${claim.dateOfService ?? 'missing'}`,
    `Provider: ${claim.provider.name} (${claim.provider.providerId})`,
    `Diagnosis codes: ${claim.diagnosisCodes.length > 0 ? claim.diagnosisCodes.join(', ') : 'none'}`,
    'Line items:'
  ];

  claim.lineItems.forEach((lineItem) => {
    const decision = findDecision(claim, lineItem.lineItemId);
    lines.push(`- ${lineItem.lineItemId} ${lineItem.serviceCode}: ${lineItem.description}`);
    lines.push(`  State: ${lineItem.status}`);
    lines.push(`  Service date: ${getServiceDateForLineItem(claim, lineItem) ?? 'missing'}`);
    lines.push(`  Billed amount: ${lineItem.billedAmount.toFixed(2)}`);
    lines.push(`  Payer amount: ${formatMoney(decision?.payerAmount ?? null)}`);
    lines.push(`  Member responsibility: ${formatMoney(decision?.memberResponsibility ?? null)}`);
    lines.push(`  Reason: ${decision?.reasonText ?? 'n/a'}`);
    lines.push(`  Next step: ${decision?.memberNextStep ?? 'n/a'}`);
    lines.push(...formatLineDecisionExplanation(claim, lineItem, decision, context));
  });

  return lines.join('\n');
}

function formatPolicy(policy: Policy): string {
  const lines: string[] = [
    `Policy ${policy.policyId}`,
    `Member: ${policy.memberId}`,
    `Type: ${policy.policyType}`,
    `Effective date: ${policy.effectiveDate}`,
    `Benefit period: ${policy.coverageRules.benefitPeriod}`,
    `Deductible: ${policy.coverageRules.deductible.toFixed(2)}`,
    `Coinsurance percent: ${policy.coverageRules.coinsurancePercent}`,
    `Annual out-of-pocket max: ${policy.coverageRules.annualOutOfPocketMax.toFixed(2)}`,
    'Service rules:'
  ];

  policy.coverageRules.serviceRules.forEach((serviceRule) => {
    lines.push(
      `- ${serviceRule.serviceCode}: covered=${serviceRule.covered}, yearlyDollarCap=${serviceRule.yearlyDollarCap ?? 'none'}, yearlyVisitCap=${serviceRule.yearlyVisitCap ?? 'none'}`
    );
  });

  return lines.join('\n');
}

function formatDispute(dispute: {
  disputeId: string;
  claimId: string;
  memberId: string;
  status: string;
  reason: string;
  note: string | null;
  referencedLineItemIds: string[];
  resolvedAt: string | null;
  resolutionNote: string | null;
}): string {
  return [
    `Dispute ${dispute.disputeId}`,
    `Claim: ${dispute.claimId}`,
    `Member: ${dispute.memberId}`,
    `Status: ${dispute.status}`,
    `Reason: ${dispute.reason}`,
    `Note: ${dispute.note ?? 'n/a'}`,
    `Referenced line items: ${dispute.referencedLineItemIds.length > 0 ? dispute.referencedLineItemIds.join(', ') : 'none'}`,
    `Resolved at: ${dispute.resolvedAt ?? 'n/a'}`,
    `Resolution note: ${dispute.resolutionNote ?? 'n/a'}`
  ].join('\n');
}

function summarizeAccumulatorEntries(entries: AccumulatorEntry[]): string {
  const dollarTotal = entries
    .filter((entry) => entry.metricType === 'dollars_paid')
    .reduce((sum, entry) => sum + entry.delta, 0);
  const visitTotal = entries
    .filter((entry) => entry.metricType === 'visits_used')
    .reduce((sum, entry) => sum + entry.delta, 0);
  const memberOopTotal = entries
    .filter((entry) => entry.metricType === 'member_oop_applied')
    .reduce((sum, entry) => sum + entry.delta, 0);
  const deductibleTotal = entries
    .filter((entry) => entry.metricType === 'deductible_applied')
    .reduce((sum, entry) => sum + entry.delta, 0);

  const lines = [
    `Accumulator entries: ${entries.length}`,
    `Total dollars paid usage: ${dollarTotal.toFixed(2)}`,
    `Total visits used: ${visitTotal}`,
    `Total member out-of-pocket applied: ${memberOopTotal.toFixed(2)}`,
    `Total deductible applied: ${deductibleTotal.toFixed(2)}`
  ];

  if (entries.length > 0) {
    lines.push('Entries:');
    entries.forEach((entry) => {
      lines.push(
        `- ${entry.metricType}: delta=${entry.delta} sourceId=${entry.sourceId} period=${entry.benefitPeriodStart}..${entry.benefitPeriodEnd} status=${entry.status}`
      );
    });
  }

  return lines.join('\n');
}

function formatAccumulatorSummaryForService(
  policy: Policy | null,
  serviceCode: string,
  periodStart: string | null,
  periodEnd: string | null,
  entries: AccumulatorEntry[]
): string {
  const serviceRule = policy?.coverageRules.serviceRules.find((rule) => rule.serviceCode === serviceCode);
  const usage =
    periodStart && periodEnd
      ? getAccumulatorUsage(entries, periodStart, periodEnd)
      : { usedDollars: 0, usedVisits: 0, memberOopApplied: 0, deductibleApplied: 0 };

  const lines = [summarizeAccumulatorEntries(entries)];

  if (serviceRule) {
    lines.push(
      `Service rule summary: covered=${serviceRule.covered}, yearlyDollarCap=${serviceRule.yearlyDollarCap ?? 'none'}, yearlyVisitCap=${serviceRule.yearlyVisitCap ?? 'none'}`
    );

    if (serviceRule.yearlyDollarCap !== null) {
      lines.push(
        `Remaining yearly dollar benefit: ${Math.max(0, serviceRule.yearlyDollarCap - usage.usedDollars).toFixed(2)}`
      );
    }

    if (serviceRule.yearlyVisitCap !== null) {
      lines.push(`Remaining yearly visit benefit: ${Math.max(0, serviceRule.yearlyVisitCap - usage.usedVisits)}`);
    }
  }

  if (periodStart && periodEnd) {
    lines.push(`Benefit period window: ${periodStart}..${periodEnd}`);
  }

  return lines.join('\n');
}

function formatAccumulatorEffects(
  policy: Policy | null,
  periodStart: string | null,
  periodEnd: string | null,
  claim: Claim,
  entries: AccumulatorEntry[]
): string {
  const entriesByService = new Map<string, AccumulatorEntry[]>();
  entries.forEach((entry) => {
    entriesByService.set(entry.serviceCode, [...(entriesByService.get(entry.serviceCode) ?? []), entry]);
  });

  const lines = ['Accumulator effects from this adjudication:'];
  const serviceCodes = [...new Set(claim.lineItems.map((lineItem) => lineItem.serviceCode))];
  serviceCodes.forEach((serviceCode) => {
    const serviceEntries = entriesByService.get(serviceCode) ?? [];
    if (serviceEntries.length === 0) {
      return;
    }

    lines.push(`Service: ${serviceCode}`);
    lines.push(formatAccumulatorSummaryForService(policy, serviceCode, periodStart, periodEnd, serviceEntries));
  });

  if (lines.length === 1) {
    lines.push('No accumulator entries were posted by this adjudication.');
  }

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
      'create member',
      'create policy',
      'seed demo-data',
      'show member',
      'show dispute',
      'show accumulator',
      'list policies',
      'list claims',
      'list disputes',
      'resolve dispute',
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
    '  create member --full-name NAME --date-of-birth YYYY-MM-DD [--db PATH]',
    '  create policy <memberId> [--db PATH] --json FILE',
    '  create policy <memberId> [--db PATH] --policy-type TYPE --effective-date YYYY-MM-DD --benefit-period policy_year --deductible AMOUNT --coinsurance-percent PERCENT --annual-out-of-pocket-max AMOUNT --service-rule "serviceCode|covered|yearlyDollarCap|yearlyVisitCap" [--service-rule ...]',
    '  seed demo-data [--db PATH]',
    '  show member <memberId> [--db PATH]',
    '  show dispute <disputeId> [--db PATH]',
    '  show accumulator <policyId> <serviceCode> [--db PATH]',
    '  list policies <memberId> [--db PATH]',
    '  list claims <memberId> [--db PATH]',
    '  list disputes <claimId> [--db PATH]',
    '  submit claim [--db PATH] --json FILE',
    '  submit claim [--db PATH] --member-id ID --policy-id ID --provider-id ID --provider-name NAME --date-of-service YYYY-MM-DD [--diagnosis-code CODE]... --line-item "serviceCode|description|billedAmount|dateOfService(optional)" [--line-item ...]',
    '  adjudicate claim <claimId> [--db PATH]',
    '  resolve manual-review <claimId> <lineItemId> <approved|denied> [--db PATH]',
    '  pay claim <claimId> [--db PATH] --line-item-id ID [--line-item-id ...]',
    '  pay claim <claimId> [--db PATH] --all-approved',
    '  open dispute <claimId> [--db PATH] --reason TEXT [--note TEXT] [--line-item-id ID]...',
    '  resolve dispute <disputeId> <upheld|overturned> [--db PATH] [--note TEXT]',
    '  show claim <claimId> [--db PATH]',
    '  help',
    '',
    'Examples:',
    `  npm run cli -- seed demo-data --db ${DEFAULT_DB_PATH}`,
    '  npm run cli -- create member --full-name "Aarav Mehta" --date-of-birth 1988-07-14',
    '  npm run cli -- create policy MEM-0001 --policy-type "Health PPO" --effective-date 2026-01-01 --benefit-period policy_year --deductible 500 --coinsurance-percent 80 --annual-out-of-pocket-max 3000 --service-rule "office_visit|true|1000|10"',
    '  npm run cli -- show member MEM-0001',
    '  npm run cli -- list claims MEM-0001',
    '  npm run cli -- list policies MEM-0001',
    '  npm run cli -- submit claim --json ./claim.json',
    '  npm run cli -- submit claim --member-id MEM-0001 --policy-id POL-0001 --provider-id PRV-9001 --provider-name "CityCare Clinic" --date-of-service 2026-03-01 --diagnosis-code J02.9 --line-item "office_visit|Primary care consultation|150|2026-03-01"',
    '  npm run cli -- adjudicate claim CLM-0001',
    '  npm run cli -- show accumulator POL-0001 office_visit',
    '  npm run cli -- resolve manual-review CLM-0001 LI-0005 approved',
    '  npm run cli -- pay claim CLM-0001 --all-approved',
    '  npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --line-item-id LI-0004',
    '  npm run cli -- resolve dispute DSP-0001 overturned --note "Manual approval after review."',
    '  npm run cli -- list disputes CLM-0001',
    '  npm run cli -- show dispute DSP-0001',
    '  npm run cli -- show claim CLM-0001'
  ].join('\n');
}

function getDbPath(parsed: ParsedArguments): string | undefined {
  return getFlagValue(parsed, 'db');
}

function parseLineItemFlag(value: string): { serviceCode: string; description: string; billedAmount: number; dateOfService?: string } {
  const [serviceCode, description, billedAmountText, dateOfService, ...rest] = value.split('|');
  if (!serviceCode || !description || !billedAmountText || rest.length > 0) {
    throw new ValidationError(
      'Each --line-item value must use "serviceCode|description|billedAmount" or "serviceCode|description|billedAmount|dateOfService".'
    );
  }

  const billedAmount = Number(billedAmountText);
  if (Number.isNaN(billedAmount)) {
    throw new ValidationError('Each --line-item billed amount must be numeric.');
  }

  return {
    serviceCode,
    description,
    billedAmount,
    ...(dateOfService ? { dateOfService } : {})
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
    dateOfService: requireFlagValue(parsed, 'date-of-service', 'date-of-service'),
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
        dateOfService: string;
        diagnosisCodes: string[];
        lineItems: Array<{ serviceCode: string; description: string; billedAmount: number; dateOfService?: string }>;
      };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ValidationError(`Unable to read claim JSON from ${filePath}: ${message}`);
  }
}

function parseCoverageRulesFromJsonFile(filePath: string): CoverageRules {
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as CoverageRules;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ValidationError(`Unable to read coverage rules JSON from ${filePath}: ${message}`);
  }
}

function parseServiceRuleFlag(value: string) {
  const [serviceCode, coveredText, yearlyDollarCapText, yearlyVisitCapText, ...rest] = value.split('|');
  if (!serviceCode || !coveredText || yearlyDollarCapText === undefined || yearlyVisitCapText === undefined || rest.length > 0) {
    throw new ValidationError(
      'Each --service-rule value must use "serviceCode|covered|yearlyDollarCap|yearlyVisitCap".'
    );
  }

  if (coveredText !== 'true' && coveredText !== 'false') {
    throw new ValidationError('Each --service-rule covered value must be true or false.');
  }

  const yearlyDollarCap =
    yearlyDollarCapText === 'null' ? null : Number.isNaN(Number(yearlyDollarCapText)) ? NaN : Number(yearlyDollarCapText);
  const yearlyVisitCap =
    yearlyVisitCapText === 'null' ? null : Number.isNaN(Number(yearlyVisitCapText)) ? NaN : Number(yearlyVisitCapText);

  if (yearlyDollarCap !== null && Number.isNaN(yearlyDollarCap)) {
    throw new ValidationError('Each --service-rule yearlyDollarCap must be numeric or null.');
  }

  if (yearlyVisitCap !== null && (!Number.isInteger(yearlyVisitCap) || Number.isNaN(yearlyVisitCap))) {
    throw new ValidationError('Each --service-rule yearlyVisitCap must be an integer or null.');
  }

  return {
    serviceCode,
    covered: coveredText === 'true',
    yearlyDollarCap,
    yearlyVisitCap
  };
}

function parseCoverageRulesFromFlags(parsed: ParsedArguments): CoverageRules {
  const benefitPeriod = requireFlagValue(parsed, 'benefit-period', 'benefit-period');
  if (benefitPeriod !== 'policy_year') {
    throw new ValidationError('benefit-period must be policy_year.');
  }

  const serviceRuleFlags = getFlagValues(parsed, 'service-rule');

  return {
    benefitPeriod,
    deductible: Number(requireFlagValue(parsed, 'deductible', 'deductible')),
    coinsurancePercent: Number(requireFlagValue(parsed, 'coinsurance-percent', 'coinsurance-percent')),
    annualOutOfPocketMax: Number(
      requireFlagValue(parsed, 'annual-out-of-pocket-max', 'annual-out-of-pocket-max')
    ),
    serviceRules: serviceRuleFlags.map(parseServiceRuleFlag)
  };
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
    if (parsed.commandKey === 'create member') {
      const member = await createMember(
        { memberRepository: context.memberRepository, idGenerator: context.idGenerator },
        {
          fullName: requireFlagValue(parsed, 'full-name', 'full-name'),
          dateOfBirth: requireFlagValue(parsed, 'date-of-birth', 'date-of-birth')
        }
      );

      writeLine(environment.stdout, `Created member ${member.memberId}.`);
      writeLine(environment.stdout, `Full name: ${member.fullName}`);
      writeLine(environment.stdout, `Date of birth: ${member.dateOfBirth}`);
      return 0;
    }

    if (parsed.commandKey === 'create policy') {
      const memberId = parsed.positionals[0];
      if (!memberId) {
        throw new ValidationError('memberId is required.');
      }

      const coverageRulesPath = getFlagValue(parsed, 'json');
      const policy = await createPolicy(
        {
          memberRepository: context.memberRepository,
          policyRepository: context.policyRepository,
          idGenerator: context.idGenerator
        },
        {
          memberId,
          policyType: requireFlagValue(parsed, 'policy-type', 'policy-type'),
          effectiveDate: requireFlagValue(parsed, 'effective-date', 'effective-date'),
          coverageRules: coverageRulesPath ? parseCoverageRulesFromJsonFile(coverageRulesPath) : parseCoverageRulesFromFlags(parsed)
        }
      );

      writeLine(environment.stdout, `Created policy ${policy.policyId}.`);
      writeLine(environment.stdout, formatPolicy(policy));
      return 0;
    }

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
        writeLine(environment.stdout, formatPolicy(policy));
        writeLine(environment.stdout);
      });
      return 0;
    }

    if (parsed.commandKey === 'list claims') {
      const memberId = parsed.positionals[0];
      if (!memberId) {
        throw new ValidationError('memberId is required.');
      }

      const claims = await listMemberClaims(context.claimRepository, memberId);
      if (claims.length === 0) {
        writeLine(environment.stdout, `No claims found for member ${memberId}.`);
        return 0;
      }

      claims.forEach((claim) => {
        writeLine(environment.stdout, `Claim ${claim.claimId}`);
        writeLine(environment.stdout, `  Status: ${claim.status}`);
        writeLine(environment.stdout, `  Policy: ${claim.policyId}`);
        writeLine(environment.stdout, `  Approved line items: ${claim.approvedLineItemCount}`);
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

      const formattingContext = await buildClaimFormattingContext(claim, {
        policyRepository: context.policyRepository,
        accumulatorRepository: context.accumulatorRepository,
        disputeRepository: context.disputeRepository
      });
      writeLine(environment.stdout, `Created claim ${claim.claimId}.`);
      writeLine(environment.stdout, formatClaim(claim, formattingContext));
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
          accumulatorRepository: context.accumulatorRepository
        },
        claimId
      );

      const formattingContext = await buildClaimFormattingContext(result.claim, {
        policyRepository: context.policyRepository,
        accumulatorRepository: context.accumulatorRepository,
        disputeRepository: context.disputeRepository
      });
      writeLine(environment.stdout, `Adjudicated claim ${claimId}.`);
      writeLine(environment.stdout, formatClaim(result.claim, formattingContext));
      writeLine(environment.stdout);
      writeLine(
        environment.stdout,
        formatAccumulatorEffects(
          formattingContext.policy,
          formattingContext.periodStart,
          formattingContext.periodEnd,
          result.claim,
          result.accumulatorEffects
        )
      );
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
          accumulatorRepository: context.accumulatorRepository
        },
        { claimId, lineItemId, decision }
      );

      const formattingContext = await buildClaimFormattingContext(result.claim, {
        policyRepository: context.policyRepository,
        accumulatorRepository: context.accumulatorRepository,
        disputeRepository: context.disputeRepository
      });
      writeLine(environment.stdout, `Resolved manual review for ${lineItemId} on claim ${claimId}.`);
      writeLine(environment.stdout, formatClaim(result.claim, formattingContext));
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
      const formattingContext = await buildClaimFormattingContext(result.claim, {
        policyRepository: context.policyRepository,
        accumulatorRepository: context.accumulatorRepository,
        disputeRepository: context.disputeRepository
      });
      writeLine(environment.stdout, `Recorded payment for claim ${claimId}.`);
      writeLine(environment.stdout, formatClaim(result.claim, formattingContext));
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
      writeLine(environment.stdout, formatDispute(dispute));
      writeLine(environment.stdout);
      writeLine(
        environment.stdout,
        `Next: run "npm run cli -- list disputes ${dispute.claimId}${dbPath ? ` --db ${dbPath}` : ''}" to review all disputes for this claim.`
      );
      writeLine(
        environment.stdout,
        `Next: run "npm run cli -- show claim ${dispute.claimId}${dbPath ? ` --db ${dbPath}` : ''}" to inspect the claim state alongside the dispute.`
      );
      return 0;
    }

    if (parsed.commandKey === 'list disputes') {
      const claimId = parsed.positionals[0];
      if (!claimId) {
        throw new ValidationError('claimId is required.');
      }

      const disputes = await listClaimDisputes(context.disputeRepository, claimId);
      if (disputes.length === 0) {
        writeLine(environment.stdout, `No disputes found for claim ${claimId}.`);
        return 0;
      }

      disputes.forEach((dispute) => {
        writeLine(environment.stdout, formatDispute(dispute));
        writeLine(environment.stdout);
      });
      return 0;
    }

    if (parsed.commandKey === 'resolve dispute') {
      const [disputeId, outcome] = parsed.positionals;
      if (!disputeId || (outcome !== 'upheld' && outcome !== 'overturned')) {
        throw new ValidationError('Usage: resolve dispute <disputeId> <upheld|overturned>');
      }

      const result = await resolveDisputeCommand(
        {
          claimRepository: context.claimRepository,
          policyRepository: context.policyRepository,
          disputeRepository: context.disputeRepository,
          accumulatorRepository: context.accumulatorRepository,
          clock: context.clock
        },
        (() => {
          const input = {
            disputeId,
            outcome
          } as const;
          const note = getFlagValue(parsed, 'note');
          return note === undefined ? input : { ...input, note };
        })()
      );

      const formattingContext = await buildClaimFormattingContext(result.claim, {
        policyRepository: context.policyRepository,
        accumulatorRepository: context.accumulatorRepository,
        disputeRepository: context.disputeRepository
      });
      writeLine(environment.stdout, `Resolved dispute ${disputeId} as ${outcome}.`);
      writeLine(environment.stdout, formatDispute(result.dispute));
      writeLine(environment.stdout);
      writeLine(environment.stdout, formatClaim(result.claim, formattingContext));
      if (result.accumulatorEffects.length > 0) {
        writeLine(environment.stdout);
        writeLine(
          environment.stdout,
          formatAccumulatorEffects(
            formattingContext.policy,
            formattingContext.periodStart,
            formattingContext.periodEnd,
            result.claim,
            result.accumulatorEffects
          )
        );
      }
      return 0;
    }

    if (parsed.commandKey === 'show dispute') {
      const disputeId = parsed.positionals[0];
      if (!disputeId) {
        throw new ValidationError('disputeId is required.');
      }

      const dispute = await getDispute(context.disputeRepository, disputeId);
      writeLine(environment.stdout, formatDispute(dispute));
      return 0;
    }

    if (parsed.commandKey === 'show accumulator') {
      const [policyId, serviceCode] = parsed.positionals;
      if (!policyId || !serviceCode) {
        throw new ValidationError('Usage: show accumulator <policyId> <serviceCode>');
      }

      const entries = await context.accumulatorRepository.listByPolicyAndService(policyId, serviceCode);
      const policy = await context.policyRepository.getById(policyId);
      const period = policy ? getBenefitPeriodWindow(policy.effectiveDate, context.clock.now()) : null;
      writeLine(environment.stdout, `Accumulator for policy ${policyId} service ${serviceCode}`);
      writeLine(
        environment.stdout,
        formatAccumulatorSummaryForService(policy, serviceCode, period?.start ?? null, period?.end ?? null, entries)
      );
      return 0;
    }

    if (parsed.commandKey === 'show claim') {
      const claimId = parsed.positionals[0];
      if (!claimId) {
        throw new ValidationError('claimId is required.');
      }

      const claim = await getClaim(context.claimRepository, claimId);
      const formattingContext = await buildClaimFormattingContext(claim, {
        policyRepository: context.policyRepository,
        accumulatorRepository: context.accumulatorRepository,
        disputeRepository: context.disputeRepository
      });
      writeLine(environment.stdout, formatClaim(claim, formattingContext));
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
