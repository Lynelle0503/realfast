import type { Member } from '../../domain/member.js';
import type { MemberRepository } from '../../ports/repositories.js';
import { NotFoundError } from '../errors/not-found-error.js';

export async function getMember(memberRepository: MemberRepository, memberId: string): Promise<Member> {
  const member = await memberRepository.getById(memberId);
  if (!member) {
    throw new NotFoundError(`Member ${memberId} was not found.`);
  }

  return member;
}
