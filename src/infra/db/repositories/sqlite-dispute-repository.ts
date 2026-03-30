import type Database from 'better-sqlite3';

import type { Dispute } from '../../../core/domain/dispute.js';
import type { DisputeRepository } from '../../../core/ports/repositories.js';
import { mapDisputeRow } from '../mappers/dispute-row-mapper.js';
import { stringifyJson } from '../support/json.js';

interface DisputeRow {
  id: string;
  claim_id: string;
  member_id: string;
  status: string;
  reason: string;
  note: string | null;
  referenced_line_item_ids_json: string;
}

export class SqliteDisputeRepository implements DisputeRepository {
  constructor(private readonly db: Database.Database) {}

  async create(dispute: Dispute): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO disputes (
           id,
           claim_id,
           member_id,
           status,
           reason,
           note,
           referenced_line_item_ids_json
         ) VALUES (
           @id,
           @claim_id,
           @member_id,
           @status,
           @reason,
           @note,
           @referenced_line_item_ids_json
         )`
      )
      .run({
        id: dispute.disputeId,
        claim_id: dispute.claimId,
        member_id: dispute.memberId,
        status: dispute.status,
        reason: dispute.reason,
        note: dispute.note,
        referenced_line_item_ids_json: stringifyJson(dispute.referencedLineItemIds)
      });
  }

  async getById(disputeId: string): Promise<Dispute | null> {
    const row = this.db
      .prepare(
        `SELECT id, claim_id, member_id, status, reason, note, referenced_line_item_ids_json
         FROM disputes
         WHERE id = ?`
      )
      .get(disputeId) as DisputeRow | undefined;

    return row ? mapDisputeRow(row) : null;
  }

  async listByClaimId(claimId: string): Promise<Dispute[]> {
    const rows = this.db
      .prepare(
        `SELECT id, claim_id, member_id, status, reason, note, referenced_line_item_ids_json
         FROM disputes
         WHERE claim_id = ?
         ORDER BY id`
      )
      .all(claimId) as DisputeRow[];

    return rows.map(mapDisputeRow);
  }
}
