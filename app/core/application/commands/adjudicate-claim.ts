import type { Claim } from '../../domain/claim.js';
import type { AccumulatorRepository, ClaimRepository, Clock, PolicyRepository } from '../../ports/repositories.js';
import { applyClaimRollup } from '../services/claim-rollup-service.js';
import { adjudicateClaim } from '../services/adjudication-service.js';
import { NotFoundError } from '../errors/not-found-error.js';
import { BusinessRuleError } from '../errors/business-rule-error.js';

export async function adjudicateClaimCommand(
  dependencies: {
    claimRepository: ClaimRepository;
    policyRepository: PolicyRepository;
    accumulatorRepository: AccumulatorRepository;
    clock?: Clock;
  },
  claimId: string
): Promise<{ claim: Claim; accumulatorEffects: Awaited<ReturnType<AccumulatorRepository['listByPolicy']>> }> {
  const claim = await dependencies.claimRepository.getById(claimId);
  if (!claim) {
    throw new NotFoundError(`Claim ${claimId} was not found.`);
  }

  if (!claim.lineItems.some((lineItem) => lineItem.status === 'submitted')) {
    throw new BusinessRuleError('There are no unresolved submitted line items to adjudicate.');
  }

  const policy = await dependencies.policyRepository.getById(claim.policyId);
  if (!policy) {
    throw new NotFoundError(`Policy ${claim.policyId} was not found.`);
  }

  const policyAccumulatorEntries = await dependencies.accumulatorRepository.listByPolicy(claim.policyId);
  const accumulatorEntriesByService = new Map<string, Awaited<ReturnType<AccumulatorRepository['listByPolicyAndService']>>>(
    [...new Set(claim.lineItems.map((lineItem) => lineItem.serviceCode))].map((serviceCode) => [
      serviceCode,
      policyAccumulatorEntries.filter((entry) => entry.serviceCode === serviceCode)
    ])
  );

  const result = adjudicateClaim({
    claim,
    policy,
    accumulatorEntriesByService,
    accumulatorEntriesForPolicy: policyAccumulatorEntries
  });

  const updatedClaim = applyClaimRollup({
    ...claim,
    lineItems: result.lineItems,
    lineDecisions: result.lineDecisions
  });

  await dependencies.claimRepository.update(updatedClaim);
  await dependencies.accumulatorRepository.appendMany(result.accumulatorEntries);

  return { claim: updatedClaim, accumulatorEffects: result.accumulatorEntries };
}
