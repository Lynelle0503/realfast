import type { Policy } from '../../domain/policy.js';
import type { PolicyRepository } from '../../ports/repositories.js';

export async function listMemberPolicies(policyRepository: PolicyRepository, memberId: string): Promise<Policy[]> {
  return policyRepository.listByMemberId(memberId);
}
