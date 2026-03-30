import type { Claim, ClaimLineItem, CreateClaimInput } from '../../domain/claim.js';
import type { ClaimRepository, IdGenerator, MemberRepository, PolicyRepository } from '../../ports/repositories.js';
import { BusinessRuleError } from '../errors/business-rule-error.js';
import { NotFoundError } from '../errors/not-found-error.js';
import { ValidationError } from '../errors/validation-error.js';

export async function createClaim(
  dependencies: {
    memberRepository: MemberRepository;
    policyRepository: PolicyRepository;
    claimRepository: ClaimRepository;
    idGenerator: IdGenerator;
  },
  input: CreateClaimInput
): Promise<Claim> {
  if (input.lineItems.length === 0) {
    throw new ValidationError('A claim must include at least one line item.');
  }

  const member = await dependencies.memberRepository.getById(input.memberId);
  if (!member) {
    throw new NotFoundError(`Member ${input.memberId} was not found.`);
  }

  const policy = await dependencies.policyRepository.getById(input.policyId);
  if (!policy) {
    throw new NotFoundError(`Policy ${input.policyId} was not found.`);
  }

  if (policy.memberId !== input.memberId) {
    throw new BusinessRuleError('The policy does not belong to the member.');
  }

  const existingClaims = await dependencies.claimRepository.listByMemberId(input.memberId);
  const duplicateClaim = existingClaims.find((claim) => claim.policyId === input.policyId);
  if (duplicateClaim) {
    throw new BusinessRuleError('Only one claim is allowed for a member on a particular policy.');
  }

  const lineItems: ClaimLineItem[] = input.lineItems.map((lineItem) => ({
    lineItemId: dependencies.idGenerator.next('LI'),
    serviceCode: lineItem.serviceCode,
    description: lineItem.description,
    billedAmount: lineItem.billedAmount,
    status: 'submitted'
  }));

  const claim: Claim = {
    claimId: dependencies.idGenerator.next('CLM'),
    memberId: input.memberId,
    policyId: input.policyId,
    provider: input.provider,
    diagnosisCodes: input.diagnosisCodes,
    status: 'submitted',
    approvedLineItemCount: 0,
    lineItems,
    lineDecisions: []
  };

  await dependencies.claimRepository.create(claim);
  return claim;
}
