import type { Claim } from '../../domain/claim.js';
import type { Dispute, ResolveDisputeInput } from '../../domain/dispute.js';
import type { AccumulatorRepository, ClaimRepository, Clock, DisputeRepository, PolicyRepository } from '../../ports/repositories.js';
import { BusinessRuleError } from '../errors/business-rule-error.js';
import { NotFoundError } from '../errors/not-found-error.js';
import { applyClaimRollup } from '../services/claim-rollup-service.js';
import { overturnDeniedLineItems } from '../services/adjudication-service.js';

export async function resolveDisputeCommand(
  dependencies: {
    claimRepository: ClaimRepository;
    policyRepository: PolicyRepository;
    disputeRepository: DisputeRepository;
    accumulatorRepository: AccumulatorRepository;
    clock: Clock;
  },
  input: ResolveDisputeInput
): Promise<{ dispute: Dispute; claim: Claim; accumulatorEffects: Awaited<ReturnType<AccumulatorRepository['listByPolicy']>> }> {
  const dispute = await dependencies.disputeRepository.getById(input.disputeId);
  if (!dispute) {
    throw new NotFoundError(`Dispute ${input.disputeId} was not found.`);
  }

  if (dispute.status !== 'open') {
    throw new BusinessRuleError('Only open disputes can be resolved.');
  }

  const claim = await dependencies.claimRepository.getById(dispute.claimId);
  if (!claim) {
    throw new NotFoundError(`Claim ${dispute.claimId} was not found.`);
  }

  const resolvedAt = dependencies.clock.now().toISOString();
  const resolvedDispute: Dispute = {
    ...dispute,
    status: input.outcome,
    resolvedAt,
    resolutionNote: input.note ?? null
  };

  if (input.outcome === 'upheld') {
    await dependencies.disputeRepository.update(resolvedDispute);
    return {
      dispute: resolvedDispute,
      claim,
      accumulatorEffects: []
    };
  }

  if (dispute.referencedLineItemIds.length === 0) {
    throw new BusinessRuleError('Only line-item disputes can be overturned in this version.');
  }

  if (!claim.dateOfService) {
    throw new BusinessRuleError('A dispute cannot be overturned when the claim is missing the service date.');
  }

  const deniedLineItems = dispute.referencedLineItemIds.map((lineItemId) => {
    const lineItem = claim.lineItems.find((item) => item.lineItemId === lineItemId);
    if (!lineItem) {
      throw new NotFoundError(`Line item ${lineItemId} was not found on claim ${claim.claimId}.`);
    }

    if (lineItem.status !== 'denied') {
      throw new BusinessRuleError('Only denied line items can be overturned through dispute resolution.');
    }

    return lineItem;
  });

  if (deniedLineItems.length === 0) {
    throw new BusinessRuleError('At least one denied line item is required to overturn a dispute.');
  }

  const policy = await dependencies.policyRepository.getById(claim.policyId);
  if (!policy) {
    throw new NotFoundError(`Policy ${claim.policyId} was not found.`);
  }

  const policyEntries = await dependencies.accumulatorRepository.listByPolicy(claim.policyId);
  const accumulatorEntriesByService = new Map<string, Awaited<ReturnType<AccumulatorRepository['listByPolicyAndService']>>>();
  for (const lineItem of deniedLineItems) {
    accumulatorEntriesByService.set(
      lineItem.serviceCode,
      policyEntries.filter((entry) => entry.serviceCode === lineItem.serviceCode)
    );
  }

  const result = overturnDeniedLineItems(
    claim,
    policy,
    dispute.referencedLineItemIds,
    accumulatorEntriesByService,
    policyEntries
  );

  const updatedClaim = applyClaimRollup({
    ...claim,
    lineItems: result.lineItems,
    lineDecisions: result.lineDecisions
  });

  await dependencies.claimRepository.update(updatedClaim);
  await dependencies.accumulatorRepository.appendMany(result.accumulatorEntries);
  await dependencies.disputeRepository.update(resolvedDispute);

  return {
    dispute: resolvedDispute,
    claim: updatedClaim,
    accumulatorEffects: result.accumulatorEntries
  };
}
