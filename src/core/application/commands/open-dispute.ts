import type { CreateDisputeInput, Dispute } from '../../domain/dispute.js';
import type { ClaimRepository, DisputeRepository, IdGenerator } from '../../ports/repositories.js';
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

  const dispute: Dispute = {
    disputeId: dependencies.idGenerator.next('DSP'),
    claimId: input.claimId,
    memberId: input.memberId,
    status: 'open',
    reason: input.reason,
    note: input.note ?? null,
    referencedLineItemIds: input.referencedLineItemIds ?? []
  };

  await dependencies.disputeRepository.create(dispute);
  return dispute;
}
