import type { Claim } from '../../domain/claim.js';
import type { AccumulatorRepository, ClaimRepository, Clock, PolicyRepository } from '../../ports/repositories.js';
import { BusinessRuleError } from '../errors/business-rule-error.js';
import { NotFoundError } from '../errors/not-found-error.js';
import { applyClaimRollup } from '../services/claim-rollup-service.js';
import { resolveManualReviewDecision } from '../services/adjudication-service.js';

export async function resolveManualReviewCommand(
  dependencies: {
    claimRepository: ClaimRepository;
    policyRepository: PolicyRepository;
    accumulatorRepository: AccumulatorRepository;
    clock?: Clock;
  },
  input: { claimId: string; lineItemId: string; decision: 'approved' | 'denied' }
): Promise<{ claim: Claim }> {
  const claim = await dependencies.claimRepository.getById(input.claimId);
  if (!claim) {
    throw new NotFoundError(`Claim ${input.claimId} was not found.`);
  }

  const lineItem = claim.lineItems.find((item) => item.lineItemId === input.lineItemId);
  if (!lineItem) {
    throw new NotFoundError(`Line item ${input.lineItemId} was not found.`);
  }

  if (lineItem.status !== 'manual_review') {
    throw new BusinessRuleError('Only line items in manual review can be resolved.');
  }

  const policy = await dependencies.policyRepository.getById(claim.policyId);
  if (!policy) {
    throw new NotFoundError(`Policy ${claim.policyId} was not found.`);
  }

  const policyAccumulatorEntries = await dependencies.accumulatorRepository.listByPolicy(claim.policyId);

  const result = resolveManualReviewDecision(
    claim,
    policy,
    input.lineItemId,
    input.decision,
    new Map([[lineItem.serviceCode, policyAccumulatorEntries.filter((entry) => entry.serviceCode === lineItem.serviceCode)]]),
    policyAccumulatorEntries
  );

  const updatedClaim = applyClaimRollup({
    ...claim,
    lineItems: result.lineItems,
    lineDecisions: result.lineDecisions
  });

  await dependencies.claimRepository.update(updatedClaim);
  await dependencies.accumulatorRepository.appendMany(result.accumulatorEntries);

  return { claim: updatedClaim };
}
