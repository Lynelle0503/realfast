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
    clock: Clock;
  },
  claimId: string
): Promise<{ claim: Claim; accumulatorEffects: Awaited<ReturnType<AccumulatorRepository['listByPolicyAndService']>> }> {
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

  const serviceCodes = [...new Set(claim.lineItems.map((lineItem) => lineItem.serviceCode))];
  const accumulatorEntriesByService = new Map<string, Awaited<ReturnType<AccumulatorRepository['listByPolicyAndService']>>>(
    await Promise.all(
      serviceCodes.map(
        async (serviceCode): Promise<[string, Awaited<ReturnType<AccumulatorRepository['listByPolicyAndService']>>]> => [
          serviceCode,
          await dependencies.accumulatorRepository.listByPolicyAndService(claim.policyId, serviceCode)
        ]
      )
    )
  );

  const result = adjudicateClaim({
    claim,
    policy,
    accumulatorEntriesByService,
    asOfDate: dependencies.clock.now()
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
