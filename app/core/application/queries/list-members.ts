import type { Member } from '../../domain/member.js';
import type { MemberRepository } from '../../ports/repositories.js';

export async function listMembers(memberRepository: MemberRepository): Promise<Member[]> {
  return memberRepository.listAll();
}
