import type { Claim } from '../../domain/claim.js';
import type { ClaimRepository } from '../../ports/repositories.js';
import { BusinessRuleError } from '../errors/business-rule-error.js';
import { NotFoundError } from '../errors/not-found-error.js';
import { applyClaimRollup } from '../services/claim-rollup-service.js';

export async function markClaimPayment(
  dependencies: { claimRepository: ClaimRepository },
  input: { claimId: string; lineItemIds: string[] }
): Promise<{ claim: Claim }> {
  const claim = await dependencies.claimRepository.getById(input.claimId);
  if (!claim) {
    throw new NotFoundError(`Claim ${input.claimId} was not found.`);
  }

  const requestedIds = new Set(input.lineItemIds);
  const updatedLineItems = claim.lineItems.map((lineItem) => {
    if (!requestedIds.has(lineItem.lineItemId)) {
      return lineItem;
    }

    if (lineItem.status !== 'approved') {
      throw new BusinessRuleError('Only approved line items can be marked as paid.');
    }

    return { ...lineItem, status: 'paid' as const };
  });

  const updatedClaim = applyClaimRollup({
    ...claim,
    lineItems: updatedLineItems
  });

  await dependencies.claimRepository.update(updatedClaim);
  return { claim: updatedClaim };
}
