import type { Dispute } from '../../../core/domain/dispute.js';
import { parseJsonArray } from '../support/json.js';

interface DisputeRow {
  id: string;
  claim_id: string;
  member_id: string;
  status: string;
  reason: string;
  note: string | null;
  referenced_line_item_ids_json: string;
}

export function mapDisputeRow(row: DisputeRow): Dispute {
  return {
    disputeId: row.id,
    claimId: row.claim_id,
    memberId: row.member_id,
    status: row.status,
    reason: row.reason,
    note: row.note,
    referencedLineItemIds: parseJsonArray<string>(row.referenced_line_item_ids_json)
  };
}
