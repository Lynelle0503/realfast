import type { ClaimStatus, LineDecisionType, LineItemStatus, ReasonCode } from './enums.js';

export interface Provider {
  providerId: string;
  name: string;
}

export interface ClaimLineItem {
  lineItemId: string;
  serviceCode: string;
  description: string;
  billedAmount: number;
  status: LineItemStatus;
}

export interface LineDecision {
  lineItemId: string;
  decision: LineDecisionType;
  reasonCode: ReasonCode | null;
  reasonText: string | null;
  memberNextStep: string | null;
  payerAmount: number | null;
  memberResponsibility: number | null;
}

export interface Claim {
  claimId: string;
  memberId: string;
  policyId: string;
  provider: Provider;
  diagnosisCodes: string[];
  status: ClaimStatus;
  approvedLineItemCount: number;
  lineItems: ClaimLineItem[];
  lineDecisions: LineDecision[];
}

export interface CreateClaimLineItemInput {
  serviceCode: string;
  description: string;
  billedAmount: number;
}

export interface CreateClaimInput {
  memberId: string;
  policyId: string;
  provider: Provider;
  diagnosisCodes: string[];
  lineItems: CreateClaimLineItemInput[];
}
