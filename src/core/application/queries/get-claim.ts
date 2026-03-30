import type { Claim } from '../../domain/claim.js';
import type { ClaimRepository } from '../../ports/repositories.js';
import { NotFoundError } from '../errors/not-found-error.js';

export async function getClaim(claimRepository: ClaimRepository, claimId: string): Promise<Claim> {
  const claim = await claimRepository.getById(claimId);
  if (!claim) {
    throw new NotFoundError(`Claim ${claimId} was not found.`);
  }

  return claim;
}
