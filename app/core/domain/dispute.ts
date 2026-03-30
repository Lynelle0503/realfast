import type { DisputeStatus } from './enums.js';

export interface Dispute {
  disputeId: string;
  claimId: string;
  memberId: string;
  status: DisputeStatus;
  reason: string;
  note: string | null;
  referencedLineItemIds: string[];
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface CreateDisputeInput {
  claimId: string;
  memberId?: string;
  reason: string;
  note?: string;
  referencedLineItemIds?: string[];
}

export interface ResolveDisputeInput {
  disputeId: string;
  outcome: Exclude<DisputeStatus, 'open'>;
  note?: string;
}
