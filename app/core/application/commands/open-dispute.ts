import type { CreateDisputeInput, Dispute } from '../../domain/dispute.js';
import type { ClaimRepository, DisputeRepository, IdGenerator } from '../../ports/repositories.js';
import { BusinessRuleError } from '../errors/business-rule-error.js';
import { NotFoundError } from '../errors/not-found-error.js';

export async function openDispute(
  dependencies: {
    claimRepository: ClaimRepository;
    disputeRepository: DisputeRepository;
    idGenerator: IdGenerator;
  },
  input: CreateDisputeInput
): Promise<Dispute> {
  const claim = await dependencies.claimRepository.getById(input.claimId);
  if (!claim) {
    throw new NotFoundError(`Claim ${input.claimId} was not found.`);
  }

  if (input.memberId && input.memberId !== claim.memberId) {
    throw new BusinessRuleError('The dispute member does not match the claim member.');
  }

  const dispute: Dispute = {
    disputeId: dependencies.idGenerator.next('DSP'),
    claimId: input.claimId,
    memberId: claim.memberId,
    status: 'open',
    reason: input.reason,
    note: input.note ?? null,
    referencedLineItemIds: input.referencedLineItemIds ?? [],
    resolvedAt: null,
    resolutionNote: null
  };

  await dependencies.disputeRepository.create(dispute);
  return dispute;
}
