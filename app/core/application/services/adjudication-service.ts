import type { AccumulatorEntry } from '../../domain/accumulator.js';
import type { Claim, ClaimLineItem, LineDecision } from '../../domain/claim.js';
import type { ReasonCode } from '../../domain/enums.js';
import type { Policy, ServiceRule } from '../../domain/policy.js';
import { getAccumulatorUsage } from './accumulator-service.js';
import { getBenefitPeriodWindowForDate, type BenefitPeriodWindow } from './benefit-period-service.js';
import { buildDecisionExplanation } from './explanation-service.js';

export interface AdjudicationResult {
  lineItems: ClaimLineItem[];
  lineDecisions: LineDecision[];
  accumulatorEntries: AccumulatorEntry[];
}

interface AdjudicationContext {
  claim: Claim;
  policy: Policy;
  accumulatorEntriesByService: Map<string, AccumulatorEntry[]>;
  accumulatorEntriesForPolicy: AccumulatorEntry[];
}

interface ApprovalAmounts {
  payerAmount: number;
  memberResponsibility: number;
  memberOopApplied: number;
  deductibleApplied: number;
  deductibleSatisfied: number;
  standardPayerAmount: number;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function indexDecisions(lineDecisions: LineDecision[]): Map<string, LineDecision> {
  return new Map(lineDecisions.map((decision) => [decision.lineItemId, decision]));
}

function getDeductibleApplied(
  lineItem: ClaimLineItem,
  decision: LineDecision,
  coinsurancePercent: number
): number {
  if (decision.payerAmount === null) {
    return 0;
  }

  const coinsuranceFactor = coinsurancePercent / 100;
  if (coinsuranceFactor <= 0) {
    return lineItem.billedAmount;
  }

  const deductibleApplied = lineItem.billedAmount - decision.payerAmount / coinsuranceFactor;
  return Math.max(0, Math.min(lineItem.billedAmount, deductibleApplied));
}

function getRemainingDeductible(claim: Claim, policy: Policy): number {
  const decisionsByLineItemId = indexDecisions(claim.lineDecisions);

  const applied = claim.lineItems.reduce((sum, lineItem) => {
    if (lineItem.status !== 'approved' && lineItem.status !== 'paid') {
      return sum;
    }

    const decision = decisionsByLineItemId.get(lineItem.lineItemId);
    if (!decision) {
      return sum;
    }

    return sum + getDeductibleApplied(lineItem, decision, policy.coverageRules.coinsurancePercent);
  }, 0);

  return Math.max(0, policy.coverageRules.deductible - applied);
}

function getRemainingDeductibleForPeriod(
  claim: Claim,
  policy: Policy,
  period: BenefitPeriodWindow,
  accumulatorEntriesForPolicy: AccumulatorEntry[],
  pendingAccumulatorEntries: AccumulatorEntry[] = []
): number {
  const relevantEntries = [...accumulatorEntriesForPolicy, ...pendingAccumulatorEntries].filter(
    (entry) =>
      entry.benefitPeriodStart === period.start &&
      entry.benefitPeriodEnd === period.end &&
      entry.status === 'posted'
  );
  const ledgerUsage = getAccumulatorUsage(relevantEntries, period.start, period.end);
  const deductibleSourceIds = new Set(
    relevantEntries
      .filter((entry) => entry.metricType === 'deductible_applied')
      .map((entry) => entry.sourceId)
  );
  const decisionsByLineItemId = indexDecisions(claim.lineDecisions);

  const fallbackApplied = claim.lineItems.reduce((sum, lineItem) => {
    if (lineItem.status !== 'approved' && lineItem.status !== 'paid') {
      return sum;
    }

    if (deductibleSourceIds.has(lineItem.lineItemId)) {
      return sum;
    }

    const decision = decisionsByLineItemId.get(lineItem.lineItemId);
    if (!decision) {
      return sum;
    }

    return sum + getDeductibleApplied(lineItem, decision, policy.coverageRules.coinsurancePercent);
  }, 0);

  return Math.max(0, roundMoney(policy.coverageRules.deductible - ledgerUsage.deductibleApplied - fallbackApplied));
}

function createAccumulatorEntries(
  claim: Claim,
  lineItem: ClaimLineItem,
  payerAmount: number,
  memberOopApplied: number,
  deductibleApplied: number,
  periodStart: string,
  periodEnd: string
): AccumulatorEntry[] {
  const entries: AccumulatorEntry[] = [
    {
      memberId: claim.memberId,
      policyId: claim.policyId,
      serviceCode: lineItem.serviceCode,
      benefitPeriodStart: periodStart,
      benefitPeriodEnd: periodEnd,
      metricType: 'dollars_paid',
      delta: payerAmount,
      source: 'claim_line_item',
      sourceId: lineItem.lineItemId,
      status: 'posted'
    },
    {
      memberId: claim.memberId,
      policyId: claim.policyId,
      serviceCode: lineItem.serviceCode,
      benefitPeriodStart: periodStart,
      benefitPeriodEnd: periodEnd,
      metricType: 'visits_used',
      delta: 1,
      source: 'claim_line_item',
      sourceId: lineItem.lineItemId,
      status: 'posted'
    },
    {
      memberId: claim.memberId,
      policyId: claim.policyId,
      serviceCode: lineItem.serviceCode,
      benefitPeriodStart: periodStart,
      benefitPeriodEnd: periodEnd,
      metricType: 'member_oop_applied',
      delta: memberOopApplied,
      source: 'claim_line_item',
      sourceId: lineItem.lineItemId,
      status: 'posted'
    }
  ];

  if (deductibleApplied > 0) {
    entries.push({
      memberId: claim.memberId,
      policyId: claim.policyId,
      serviceCode: lineItem.serviceCode,
      benefitPeriodStart: periodStart,
      benefitPeriodEnd: periodEnd,
      metricType: 'deductible_applied',
      delta: deductibleApplied,
      source: 'claim_line_item',
      sourceId: lineItem.lineItemId,
      status: 'posted'
    });
  }

  return entries;
}

function getServiceRule(policy: Policy, serviceCode: string): ServiceRule | undefined {
  return policy.coverageRules.serviceRules.find((serviceRule) => serviceRule.serviceCode === serviceCode);
}

function getServiceDateForLineItem(claim: Claim, lineItem: ClaimLineItem): string | null {
  return lineItem.dateOfService ?? claim.dateOfService;
}

function createDeniedDecision(
  lineItem: ClaimLineItem,
  reasonCode: ReasonCode,
  context: {
    claim: Claim;
    policy: Policy;
    serviceRule: ServiceRule | undefined;
    serviceDate: string | null;
    remainingDollarCap?: number | null;
    remainingVisitCap?: number | null;
  }
): LineDecision {
  const explanation = buildDecisionExplanation({
    reasonCode,
    lineItemDescription: lineItem.description,
    serviceCode: lineItem.serviceCode,
    serviceDate: context.serviceDate,
    policyEffectiveDate: context.policy.effectiveDate,
    yearlyDollarCap: context.serviceRule?.yearlyDollarCap ?? null,
    yearlyVisitCap: context.serviceRule?.yearlyVisitCap ?? null,
    remainingDollarCap: context.remainingDollarCap ?? null,
    remainingVisitCap: context.remainingVisitCap ?? null,
    missingFieldLabel: 'the claim service date'
  });

  return {
    lineItemId: lineItem.lineItemId,
    decision: 'denied',
    reasonCode,
    reasonText: explanation.reasonText,
    memberNextStep: explanation.memberNextStep,
    payerAmount: 0,
    memberResponsibility: lineItem.billedAmount
  };
}

function createManualReviewDecision(
  lineItem: ClaimLineItem,
  claim: Claim,
  policy: Policy,
  serviceRule: ServiceRule,
  serviceDate: string | null,
  standardPayerAmount: number,
  remainingDollarCap: number
): LineDecision {
  const explanation = buildDecisionExplanation({
    reasonCode: 'MANUAL_REVIEW_REQUIRED',
    lineItemDescription: lineItem.description,
    serviceCode: lineItem.serviceCode,
    serviceDate,
    policyEffectiveDate: policy.effectiveDate,
    yearlyDollarCap: serviceRule.yearlyDollarCap,
    remainingDollarCap,
    standardPayerAmount
  });

  return {
    lineItemId: lineItem.lineItemId,
    decision: 'manual_review',
    reasonCode: 'MANUAL_REVIEW_REQUIRED',
    reasonText: explanation.reasonText,
    memberNextStep: explanation.memberNextStep,
    payerAmount: null,
    memberResponsibility: null
  };
}

function createApprovedDecision(lineItemId: string, payerAmount: number, memberResponsibility: number): LineDecision {
  return {
    lineItemId,
    decision: 'approved',
    reasonCode: null,
    reasonText: null,
    memberNextStep: null,
    payerAmount,
    memberResponsibility
  };
}

function getPeriodForServiceDate(serviceDate: string | null, policy: Policy): BenefitPeriodWindow | null {
  if (!serviceDate) {
    return null;
  }

  return getBenefitPeriodWindowForDate(policy.effectiveDate, serviceDate);
}

function isPolicyActiveForServiceDate(serviceDate: string | null, policy: Policy): boolean {
  if (!serviceDate) {
    return false;
  }

  return serviceDate >= policy.effectiveDate;
}

function calculateApprovalAmounts(
  lineItem: ClaimLineItem,
  policy: Policy,
  remainingDeductible: number,
  remainingOutOfPocketMax: number
): ApprovalAmounts {
  const allowedAmount = lineItem.billedAmount;
  const deductibleApplied = Math.min(allowedAmount, remainingDeductible);
  const coveredAmount = Math.max(0, allowedAmount - deductibleApplied);
  const standardPayerAmount = roundMoney((coveredAmount * policy.coverageRules.coinsurancePercent) / 100);
  const standardMemberResponsibility = roundMoney(allowedAmount - standardPayerAmount);
  const memberOopApplied = roundMoney(Math.min(standardMemberResponsibility, remainingOutOfPocketMax));
  const payerAmount = roundMoney(allowedAmount - memberOopApplied);
  const deductibleSatisfied = Math.min(deductibleApplied, memberOopApplied);

  return {
    payerAmount,
    memberResponsibility: roundMoney(allowedAmount - payerAmount),
    memberOopApplied,
    deductibleApplied,
    deductibleSatisfied,
    standardPayerAmount
  };
}

function getServiceEntries(
  serviceCode: string,
  existingEntriesByService: Map<string, AccumulatorEntry[]>,
  pendingEntries: AccumulatorEntry[]
): AccumulatorEntry[] {
  return [
    ...(existingEntriesByService.get(serviceCode) ?? []),
    ...pendingEntries.filter((entry) => entry.serviceCode === serviceCode)
  ];
}

function getPolicyEntries(existingEntries: AccumulatorEntry[], pendingEntries: AccumulatorEntry[]): AccumulatorEntry[] {
  return [...existingEntries, ...pendingEntries];
}

export function adjudicateClaim(context: AdjudicationContext): AdjudicationResult {
  const { claim, policy, accumulatorEntriesByService, accumulatorEntriesForPolicy } = context;
  const lineItems = [...claim.lineItems];
  const decisionsByLineItemId = indexDecisions(claim.lineDecisions);
  const accumulatorEntries: AccumulatorEntry[] = [];

  for (let index = 0; index < lineItems.length; index += 1) {
    const lineItem = lineItems[index];
    if (!lineItem || lineItem.status !== 'submitted') {
      continue;
    }

    const serviceDate = getServiceDateForLineItem(claim, lineItem);
    const rule = getServiceRule(policy, lineItem.serviceCode);

    if (!serviceDate) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(
        lineItem.lineItemId,
        createDeniedDecision(lineItem, 'MISSING_INFORMATION', {
          claim,
          policy,
          serviceRule: rule,
          serviceDate
        })
      );
      continue;
    }

    if (!isPolicyActiveForServiceDate(serviceDate, policy)) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(
        lineItem.lineItemId,
        createDeniedDecision(lineItem, 'POLICY_NOT_ACTIVE', { claim, policy, serviceRule: rule, serviceDate })
      );
      continue;
    }

    const period = getPeriodForServiceDate(serviceDate, policy);
    if (!period) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(
        lineItem.lineItemId,
        createDeniedDecision(lineItem, 'MISSING_INFORMATION', {
          claim,
          policy,
          serviceRule: rule,
          serviceDate
        })
      );
      continue;
    }

    const serviceEntries = getServiceEntries(lineItem.serviceCode, accumulatorEntriesByService, accumulatorEntries);
    const serviceUsage = getAccumulatorUsage(serviceEntries, period.start, period.end);
    const remainingDeductible = getRemainingDeductibleForPeriod(
      claim,
      policy,
      period,
      accumulatorEntriesForPolicy,
      accumulatorEntries
    );

    if (!rule || !rule.covered) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(
        lineItem.lineItemId,
        createDeniedDecision(lineItem, 'SERVICE_NOT_COVERED', { claim, policy, serviceRule: rule, serviceDate })
      );
      continue;
    }

    const remainingVisitCap =
      rule.yearlyVisitCap === null ? null : Math.max(0, rule.yearlyVisitCap - serviceUsage.usedVisits);
    if (rule.yearlyVisitCap !== null && remainingVisitCap !== null && remainingVisitCap <= 0) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(
        lineItem.lineItemId,
        createDeniedDecision(lineItem, 'VISIT_CAP_EXCEEDED', {
          claim,
          policy,
          serviceRule: rule,
          serviceDate,
          remainingVisitCap
        })
      );
      continue;
    }

    const policyUsage = getAccumulatorUsage(getPolicyEntries(accumulatorEntriesForPolicy, accumulatorEntries), period.start, period.end);
    const remainingOutOfPocketMax = Math.max(
      0,
      roundMoney(policy.coverageRules.annualOutOfPocketMax - policyUsage.memberOopApplied)
    );
    const approval = calculateApprovalAmounts(lineItem, policy, remainingDeductible, remainingOutOfPocketMax);

    if (rule.yearlyDollarCap !== null) {
      const remainingDollarCap = roundMoney(rule.yearlyDollarCap - serviceUsage.usedDollars);
      if (remainingDollarCap <= 0) {
        lineItems[index] = { ...lineItem, status: 'denied' };
        decisionsByLineItemId.set(
          lineItem.lineItemId,
          createDeniedDecision(lineItem, 'YEARLY_CAP_EXCEEDED', {
            claim,
            policy,
            serviceRule: rule,
            serviceDate,
            remainingDollarCap
          })
        );
        continue;
      }

      if (approval.payerAmount > remainingDollarCap) {
        lineItems[index] = { ...lineItem, status: 'manual_review' };
        decisionsByLineItemId.set(
          lineItem.lineItemId,
          createManualReviewDecision(lineItem, claim, policy, rule, serviceDate, approval.payerAmount, remainingDollarCap)
        );
        continue;
      }
    }

    lineItems[index] = { ...lineItem, status: 'approved' };
    decisionsByLineItemId.set(
      lineItem.lineItemId,
      createApprovedDecision(lineItem.lineItemId, approval.payerAmount, approval.memberResponsibility)
    );

    accumulatorEntries.push(
      ...createAccumulatorEntries(
        claim,
        lineItem,
        approval.payerAmount,
        approval.memberOopApplied,
        approval.deductibleSatisfied,
        period.start,
        period.end
      )
    );
  }

  return {
    lineItems,
    lineDecisions: [...decisionsByLineItemId.values()],
    accumulatorEntries
  };
}

export function resolveManualReviewDecision(
  claim: Claim,
  policy: Policy,
  lineItemId: string,
  decision: 'approved' | 'denied',
  accumulatorEntriesByService: Map<string, AccumulatorEntry[]>,
  accumulatorEntriesForPolicy: AccumulatorEntry[]
): AdjudicationResult {
  const lineItems = [...claim.lineItems];
  const decisionsByLineItemId = indexDecisions(claim.lineDecisions);
  const lineItemIndex = lineItems.findIndex((lineItem) => lineItem.lineItemId === lineItemId);

  if (lineItemIndex < 0) {
    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const lineItem = lineItems[lineItemIndex];
  if (!lineItem) {
    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const serviceRule = getServiceRule(policy, lineItem.serviceCode);
  const serviceDate = getServiceDateForLineItem(claim, lineItem);

  if (!serviceDate) {
    lineItems[lineItemIndex] = { ...lineItem, status: 'denied' };
    decisionsByLineItemId.set(
      lineItem.lineItemId,
      createDeniedDecision(lineItem, 'MISSING_INFORMATION', { claim, policy, serviceRule, serviceDate })
    );
    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  if (!isPolicyActiveForServiceDate(serviceDate, policy)) {
    lineItems[lineItemIndex] = { ...lineItem, status: 'denied' };
    decisionsByLineItemId.set(
      lineItem.lineItemId,
      createDeniedDecision(lineItem, 'POLICY_NOT_ACTIVE', { claim, policy, serviceRule, serviceDate })
    );
    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  if (!serviceRule || !serviceRule.covered) {
    lineItems[lineItemIndex] = { ...lineItem, status: 'denied' };
    decisionsByLineItemId.set(
      lineItem.lineItemId,
      createDeniedDecision(lineItem, 'SERVICE_NOT_COVERED', { claim, policy, serviceRule, serviceDate })
    );
    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const period = getPeriodForServiceDate(serviceDate, policy);
  if (!period) {
    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const serviceEntries = accumulatorEntriesByService.get(lineItem.serviceCode) ?? [];
  const serviceUsage = getAccumulatorUsage(serviceEntries, period.start, period.end);

  if (decision === 'denied') {
    lineItems[lineItemIndex] = { ...lineItem, status: 'denied' };
    decisionsByLineItemId.set(
      lineItem.lineItemId,
        createDeniedDecision(lineItem, 'YEARLY_CAP_EXCEEDED', {
          claim,
          policy,
          serviceRule,
          serviceDate,
          remainingDollarCap:
            serviceRule.yearlyDollarCap === null ? null : roundMoney(serviceRule.yearlyDollarCap - serviceUsage.usedDollars)
        })
    );

    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const policyUsage = getAccumulatorUsage(accumulatorEntriesForPolicy, period.start, period.end);
  const remainingOutOfPocketMax = Math.max(
    0,
    roundMoney(policy.coverageRules.annualOutOfPocketMax - policyUsage.memberOopApplied)
  );
  const remainingDeductible = getRemainingDeductibleForPeriod(claim, policy, period, accumulatorEntriesForPolicy);
  const approval = calculateApprovalAmounts(lineItem, policy, remainingDeductible, remainingOutOfPocketMax);
  const remainingDollarCap =
    serviceRule.yearlyDollarCap === null ? null : roundMoney(serviceRule.yearlyDollarCap - serviceUsage.usedDollars);

  if (remainingDollarCap !== null && remainingDollarCap <= 0) {
    lineItems[lineItemIndex] = { ...lineItem, status: 'denied' };
    decisionsByLineItemId.set(
      lineItem.lineItemId,
        createDeniedDecision(lineItem, 'YEARLY_CAP_EXCEEDED', {
          claim,
          policy,
          serviceRule,
          serviceDate,
          remainingDollarCap
        })
      );

    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const payerAmount =
    remainingDollarCap === null ? approval.payerAmount : roundMoney(Math.min(approval.payerAmount, remainingDollarCap));
  const memberResponsibility = roundMoney(lineItem.billedAmount - payerAmount);
  const memberOopApplied = roundMoney(Math.min(approval.memberOopApplied, memberResponsibility));

  lineItems[lineItemIndex] = { ...lineItem, status: 'approved' };
  decisionsByLineItemId.set(
    lineItem.lineItemId,
    createApprovedDecision(lineItem.lineItemId, payerAmount, memberResponsibility)
  );

  return {
    lineItems,
    lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: createAccumulatorEntries(
        claim,
        lineItem,
        payerAmount,
        memberOopApplied,
        approval.deductibleSatisfied,
        period.start,
        period.end
      )
  };
}

export function reconsiderDeniedLineItems(
  claim: Claim,
  policy: Policy,
  lineItemIds: string[],
  accumulatorEntriesByService: Map<string, AccumulatorEntry[]>,
  accumulatorEntriesForPolicy: AccumulatorEntry[]
): AdjudicationResult {
  const lineItemIdsToReconsider = new Set(lineItemIds);
  const claimForReconsideration: Claim = {
    ...claim,
    lineItems: claim.lineItems.map((lineItem) =>
      lineItemIdsToReconsider.has(lineItem.lineItemId) ? { ...lineItem, status: 'submitted' } : lineItem
    )
  };

  return adjudicateClaim({
    claim: claimForReconsideration,
    policy,
    accumulatorEntriesByService,
    accumulatorEntriesForPolicy
  });
}
