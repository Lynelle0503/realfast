import type { CreatePolicyInput, Policy } from '../../domain/policy.js';
import type { IdGenerator, MemberRepository, PolicyRepository } from '../../ports/repositories.js';
import { NotFoundError } from '../errors/not-found-error.js';
import { ValidationError } from '../errors/validation-error.js';

export async function createPolicy(
  dependencies: {
    memberRepository: MemberRepository;
    policyRepository: PolicyRepository;
    idGenerator: IdGenerator;
  },
  input: CreatePolicyInput
): Promise<Policy> {
  if (input.coverageRules.serviceRules.length === 0) {
    throw new ValidationError('A policy must include at least one service rule.');
  }

  const member = await dependencies.memberRepository.getById(input.memberId);
  if (!member) {
    throw new NotFoundError(`Member ${input.memberId} was not found.`);
  }

  const policy: Policy = {
    policyId: dependencies.idGenerator.next('POL'),
    memberId: input.memberId,
    policyType: input.policyType,
    effectiveDate: input.effectiveDate,
    coverageRules: input.coverageRules
  };

  await dependencies.policyRepository.create(policy);
  return policy;
}
