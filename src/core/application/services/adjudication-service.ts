import type { AccumulatorEntry } from '../../domain/accumulator.js';
import type { Claim, ClaimLineItem, LineDecision } from '../../domain/claim.js';
import type { Policy } from '../../domain/policy.js';
import { getAccumulatorUsage } from './accumulator-service.js';
import { getBenefitPeriodWindow } from './benefit-period-service.js';
import { getMemberNextStep, getReasonText } from './explanation-service.js';

export interface AdjudicationResult {
  lineItems: ClaimLineItem[];
  lineDecisions: LineDecision[];
  accumulatorEntries: AccumulatorEntry[];
}

interface AdjudicationContext {
  claim: Claim;
  policy: Policy;
  accumulatorEntriesByService: Map<string, AccumulatorEntry[]>;
  asOfDate: Date;
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

function createAccumulatorEntries(
  claim: Claim,
  lineItem: ClaimLineItem,
  payerAmount: number,
  periodStart: string,
  periodEnd: string
): AccumulatorEntry[] {
  return [
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
    }
  ];
}

export function adjudicateClaim(context: AdjudicationContext): AdjudicationResult {
  const { claim, policy, accumulatorEntriesByService, asOfDate } = context;
  const period = getBenefitPeriodWindow(policy.effectiveDate, asOfDate);

  const lineItems = [...claim.lineItems];
  const decisionsByLineItemId = indexDecisions(claim.lineDecisions);
  const accumulatorEntries: AccumulatorEntry[] = [];
  let remainingDeductible = getRemainingDeductible(claim, policy);

  for (let index = 0; index < lineItems.length; index += 1) {
    const lineItem = lineItems[index];
    if (!lineItem || lineItem.status !== 'submitted') {
      continue;
    }

    const rule = policy.coverageRules.serviceRules.find((serviceRule) => serviceRule.serviceCode === lineItem.serviceCode);
    const serviceEntries = [
      ...(accumulatorEntriesByService.get(lineItem.serviceCode) ?? []),
      ...accumulatorEntries.filter((entry) => entry.serviceCode === lineItem.serviceCode)
    ];
    const usage = getAccumulatorUsage(serviceEntries, period.start, period.end);

    if (!rule || !rule.covered) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(lineItem.lineItemId, {
        lineItemId: lineItem.lineItemId,
        decision: 'denied',
        reasonCode: 'SERVICE_NOT_COVERED',
        reasonText: getReasonText('SERVICE_NOT_COVERED'),
        memberNextStep: getMemberNextStep('SERVICE_NOT_COVERED'),
        payerAmount: 0,
        memberResponsibility: lineItem.billedAmount
      });
      continue;
    }

    if (rule.yearlyVisitCap !== null && usage.usedVisits >= rule.yearlyVisitCap) {
      lineItems[index] = { ...lineItem, status: 'denied' };
      decisionsByLineItemId.set(lineItem.lineItemId, {
        lineItemId: lineItem.lineItemId,
        decision: 'denied',
        reasonCode: 'VISIT_CAP_EXCEEDED',
        reasonText: getReasonText('VISIT_CAP_EXCEEDED'),
        memberNextStep: getMemberNextStep('VISIT_CAP_EXCEEDED'),
        payerAmount: 0,
        memberResponsibility: lineItem.billedAmount
      });
      continue;
    }

    const allowedAmount = lineItem.billedAmount;
    const deductibleApplied = Math.min(allowedAmount, remainingDeductible);
    const coveredAmount = Math.max(0, allowedAmount - deductibleApplied);
    const payerAmount = Number(((coveredAmount * policy.coverageRules.coinsurancePercent) / 100).toFixed(2));
    const memberResponsibility = Number((allowedAmount - payerAmount).toFixed(2));

    if (rule.yearlyDollarCap !== null) {
      const remainingDollarCap = Number((rule.yearlyDollarCap - usage.usedDollars).toFixed(2));

      if (remainingDollarCap <= 0) {
        lineItems[index] = { ...lineItem, status: 'denied' };
        decisionsByLineItemId.set(lineItem.lineItemId, {
          lineItemId: lineItem.lineItemId,
          decision: 'denied',
          reasonCode: 'YEARLY_CAP_EXCEEDED',
          reasonText: getReasonText('YEARLY_CAP_EXCEEDED'),
          memberNextStep: getMemberNextStep('YEARLY_CAP_EXCEEDED'),
          payerAmount: 0,
          memberResponsibility: allowedAmount
        });
        continue;
      }

      if (payerAmount > remainingDollarCap) {
        lineItems[index] = { ...lineItem, status: 'manual_review' };
        decisionsByLineItemId.set(lineItem.lineItemId, {
          lineItemId: lineItem.lineItemId,
          decision: 'manual_review',
          reasonCode: 'MANUAL_REVIEW_REQUIRED',
          reasonText: getReasonText('MANUAL_REVIEW_REQUIRED'),
          memberNextStep: null,
          payerAmount: null,
          memberResponsibility: null
        });
        continue;
      }
    }

    lineItems[index] = { ...lineItem, status: 'approved' };
    decisionsByLineItemId.set(lineItem.lineItemId, {
      lineItemId: lineItem.lineItemId,
      decision: 'approved',
      reasonCode: null,
      reasonText: null,
      memberNextStep: null,
      payerAmount,
      memberResponsibility
    });

    accumulatorEntries.push(...createAccumulatorEntries(claim, lineItem, payerAmount, period.start, period.end));
    remainingDeductible = Math.max(0, remainingDeductible - deductibleApplied);
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
  asOfDate: Date
): AdjudicationResult {
  const period = getBenefitPeriodWindow(policy.effectiveDate, asOfDate);
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

  if (decision === 'denied') {
    lineItems[lineItemIndex] = { ...lineItem, status: 'denied' };
    decisionsByLineItemId.set(lineItem.lineItemId, {
      lineItemId: lineItem.lineItemId,
      decision: 'denied',
      reasonCode: 'YEARLY_CAP_EXCEEDED',
      reasonText: getReasonText('YEARLY_CAP_EXCEEDED'),
      memberNextStep: getMemberNextStep('YEARLY_CAP_EXCEEDED'),
      payerAmount: 0,
      memberResponsibility: lineItem.billedAmount
    });

    return {
      lineItems,
      lineDecisions: [...decisionsByLineItemId.values()],
      accumulatorEntries: []
    };
  }

  const rule = policy.coverageRules.serviceRules.find((serviceRule) => serviceRule.serviceCode === lineItem.serviceCode);
  const serviceEntries = accumulatorEntriesByService.get(lineItem.serviceCode) ?? [];
  const usage = getAccumulatorUsage(serviceEntries, period.start, period.end);
  const remainingDeductible = getRemainingDeductible(claim, policy);
  const allowedAmount = lineItem.billedAmount;
  const deductibleApplied = Math.min(allowedAmount, remainingDeductible);
  const coveredAmount = Math.max(0, allowedAmount - deductibleApplied);
  const normalPayerAmount = Number(((coveredAmount * policy.coverageRules.coinsurancePercent) / 100).toFixed(2));
  const remainingDollarCap =
    rule?.yearlyDollarCap === null || rule?.yearlyDollarCap === undefined
      ? normalPayerAmount
      : Number((rule.yearlyDollarCap - usage.usedDollars).toFixed(2));
  const payerAmount = Number(Math.max(0, Math.min(normalPayerAmount, remainingDollarCap)).toFixed(2));
  const memberResponsibility = Number((allowedAmount - payerAmount).toFixed(2));

  lineItems[lineItemIndex] = { ...lineItem, status: 'approved' };
  decisionsByLineItemId.set(lineItem.lineItemId, {
    lineItemId: lineItem.lineItemId,
    decision: 'approved',
    reasonCode: null,
    reasonText: null,
    memberNextStep: null,
    payerAmount,
    memberResponsibility
  });

  return {
    lineItems,
    lineDecisions: [...decisionsByLineItemId.values()],
    accumulatorEntries: createAccumulatorEntries(claim, lineItem, payerAmount, period.start, period.end)
  };
}
