import type { Claim } from '../../domain/claim.js';
import type { ClaimRepository } from '../../ports/repositories.js';

export async function listMemberClaims(claimRepository: ClaimRepository, memberId: string): Promise<Claim[]> {
  return claimRepository.listByMemberId(memberId);
}
