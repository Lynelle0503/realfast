import type { Member } from '../../../core/domain/member.js';

interface MemberRow {
  id: string;
  full_name: string;
  date_of_birth: string;
}

export function mapMemberRow(row: MemberRow): Member {
  return {
    memberId: row.id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth
  };
}
