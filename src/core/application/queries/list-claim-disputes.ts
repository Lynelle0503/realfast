import type { Dispute } from '../../domain/dispute.js';
import type { DisputeRepository } from '../../ports/repositories.js';

export async function listClaimDisputes(disputeRepository: DisputeRepository, claimId: string): Promise<Dispute[]> {
  return disputeRepository.listByClaimId(claimId);
}
