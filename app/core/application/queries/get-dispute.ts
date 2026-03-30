import type { Dispute } from '../../domain/dispute.js';
import type { DisputeRepository } from '../../ports/repositories.js';
import { NotFoundError } from '../errors/not-found-error.js';

export async function getDispute(disputeRepository: DisputeRepository, disputeId: string): Promise<Dispute> {
  const dispute = await disputeRepository.getById(disputeId);
  if (!dispute) {
    throw new NotFoundError(`Dispute ${disputeId} was not found.`);
  }

  return dispute;
}
