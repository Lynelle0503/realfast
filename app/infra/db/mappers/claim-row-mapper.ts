import type { Claim, ClaimLineItem, LineDecision } from '../../../core/domain/claim.js';
import type { LineDecisionType, LineItemStatus, ReasonCode } from '../../../core/domain/enums.js';
import { parseJsonArray } from '../support/json.js';

interface ClaimRow {
  id: string;
  member_id: string;
  policy_id: string;
  provider_id: string;
  provider_name: string;
  date_of_service: string | null;
  diagnosis_codes_json: string;
  status: 'submitted' | 'under_review' | 'approved' | 'paid';
  approved_line_item_count: number;
}

interface ClaimLineItemRow {
  id: string;
  service_code: string;
  description: string;
  billed_amount: number;
  date_of_service: string | null;
  status: LineItemStatus;
}

interface LineDecisionRow {
  claim_line_item_id: string;
  decision: LineDecisionType;
  reason_code: ReasonCode | null;
  reason_text: string | null;
  member_next_step: string | null;
  payer_amount: number | null;
  member_responsibility: number | null;
}

function mapClaimLineItemRow(row: ClaimLineItemRow): ClaimLineItem {
  return {
    lineItemId: row.id,
    serviceCode: row.service_code,
    description: row.description,
    billedAmount: row.billed_amount,
    dateOfService: row.date_of_service,
    status: row.status
  };
}

function mapLineDecisionRow(row: LineDecisionRow): LineDecision {
  return {
    lineItemId: row.claim_line_item_id,
    decision: row.decision,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    memberNextStep: row.member_next_step,
    payerAmount: row.payer_amount,
    memberResponsibility: row.member_responsibility
  };
}

export function mapClaimRow(
  row: ClaimRow,
  lineItemRows: ClaimLineItemRow[],
  lineDecisionRows: LineDecisionRow[]
): Claim {
  return {
    claimId: row.id,
    memberId: row.member_id,
    policyId: row.policy_id,
    provider: {
      providerId: row.provider_id,
      name: row.provider_name
    },
    dateOfService: row.date_of_service,
    diagnosisCodes: parseJsonArray<string>(row.diagnosis_codes_json),
    status: row.status,
    approvedLineItemCount: row.approved_line_item_count,
    lineItems: lineItemRows.map(mapClaimLineItemRow),
    lineDecisions: lineDecisionRows.map(mapLineDecisionRow)
  };
}
