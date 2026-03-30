import type { CreateMemberInput, Member } from '../../domain/member.js';
import type { IdGenerator, MemberRepository } from '../../ports/repositories.js';
import { ValidationError } from '../errors/validation-error.js';

export async function createMember(
  dependencies: { memberRepository: MemberRepository; idGenerator: IdGenerator },
  input: CreateMemberInput
): Promise<Member> {
  if (!input.fullName.trim()) {
    throw new ValidationError('Member full name is required.');
  }

  if (!input.dateOfBirth.trim()) {
    throw new ValidationError('Member date of birth is required.');
  }

  const member: Member = {
    memberId: dependencies.idGenerator.next('MEM'),
    fullName: input.fullName,
    dateOfBirth: input.dateOfBirth
  };

  await dependencies.memberRepository.create(member);
  return member;
}
