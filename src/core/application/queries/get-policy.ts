import type { Policy } from '../../domain/policy.js';
import type { PolicyRepository } from '../../ports/repositories.js';
import { NotFoundError } from '../errors/not-found-error.js';

export async function getPolicy(policyRepository: PolicyRepository, policyId: string): Promise<Policy> {
  const policy = await policyRepository.getById(policyId);
  if (!policy) {
    throw new NotFoundError(`Policy ${policyId} was not found.`);
  }

  return policy;
}
