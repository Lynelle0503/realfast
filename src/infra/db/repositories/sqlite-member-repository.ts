import type Database from 'better-sqlite3';

import type { Member } from '../../../core/domain/member.js';
import type { MemberRepository } from '../../../core/ports/repositories.js';
import { mapMemberRow } from '../mappers/member-row-mapper.js';

interface MemberRow {
  id: string;
  full_name: string;
  date_of_birth: string;
}

export class SqliteMemberRepository implements MemberRepository {
  constructor(private readonly db: Database.Database) {}

  async create(member: Member): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO members (id, full_name, date_of_birth)
         VALUES (@id, @full_name, @date_of_birth)`
      )
      .run({
        id: member.memberId,
        full_name: member.fullName,
        date_of_birth: member.dateOfBirth
      });
  }

  async getById(memberId: string): Promise<Member | null> {
    const row = this.db
      .prepare(
        `SELECT id, full_name, date_of_birth
         FROM members
         WHERE id = ?`
      )
      .get(memberId) as MemberRow | undefined;

    return row ? mapMemberRow(row) : null;
  }
}
