import type { Claim } from '../../domain/claim.js';
import type { ClaimStatus, LineItemStatus } from '../../domain/enums.js';

function isResolved(status: LineItemStatus): boolean {
  return status !== 'submitted' && status !== 'manual_review';
}

export function getApprovedLineItemCount(claim: Pick<Claim, 'lineItems'>): number {
  return claim.lineItems.filter((lineItem) => lineItem.status === 'approved' || lineItem.status === 'paid').length;
}

export function getClaimStatus(claim: Pick<Claim, 'lineItems'>): ClaimStatus {
  const hasUnresolved = claim.lineItems.some(
    (lineItem) => !isResolved(lineItem.status) || lineItem.status === 'manual_review'
  );

  if (hasUnresolved) {
    return 'under_review';
  }

  const approvedOrPaidLineItems = claim.lineItems.filter(
    (lineItem) => lineItem.status === 'approved' || lineItem.status === 'paid'
  );

  if (approvedOrPaidLineItems.length > 0 && approvedOrPaidLineItems.every((lineItem) => lineItem.status === 'paid')) {
    return 'paid';
  }

  return 'approved';
}

export function applyClaimRollup(claim: Claim): Claim {
  return {
    ...claim,
    approvedLineItemCount: getApprovedLineItemCount(claim),
    status: getClaimStatus(claim)
  };
}
