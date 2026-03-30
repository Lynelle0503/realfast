import type { DisputeStatus } from './enums.js';

export interface Dispute {
  disputeId: string;
  claimId: string;
  memberId: string;
  status: DisputeStatus | string;
  reason: string;
  note: string | null;
  referencedLineItemIds: string[];
}

export interface CreateDisputeInput {
  claimId: string;
  memberId: string;
  reason: string;
  note?: string;
  referencedLineItemIds?: string[];
}
