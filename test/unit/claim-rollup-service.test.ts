import { describe, expect, it } from 'vitest';

import { applyClaimRollup } from '../../app/core/application/services/claim-rollup-service.js';
import type { Claim } from '../../app/core/domain/claim.js';

const baseClaim: Claim = {
  claimId: 'CLM-1',
  memberId: 'MEM-1',
  policyId: 'POL-1',
  provider: { providerId: 'PRV-1', name: 'Provider' },
  dateOfService: '2026-02-01',
  diagnosisCodes: ['J02.9'],
  status: 'submitted',
  approvedLineItemCount: 0,
  lineItems: [],
  lineDecisions: []
};

describe('claim rollup service', () => {
  it('keeps claims under review when a line is in manual review', () => {
    const claim = applyClaimRollup({
      ...baseClaim,
      lineItems: [
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'A', billedAmount: 100, status: 'approved' },
        { lineItemId: 'LI-2', serviceCode: 'lab_test', description: 'B', billedAmount: 100, status: 'manual_review' }
      ]
    });

    expect(claim.status).toBe('under_review');
    expect(claim.approvedLineItemCount).toBe(1);
  });

  it('marks claims approved when all lines are resolved but not all paid', () => {
    const claim = applyClaimRollup({
      ...baseClaim,
      lineItems: [
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'A', billedAmount: 100, status: 'approved' },
        { lineItemId: 'LI-2', serviceCode: 'lab_test', description: 'B', billedAmount: 50, status: 'denied' }
      ]
    });

    expect(claim.status).toBe('approved');
    expect(claim.approvedLineItemCount).toBe(1);
  });

  it('marks claims paid when all approved lines are paid', () => {
    const claim = applyClaimRollup({
      ...baseClaim,
      lineItems: [
        { lineItemId: 'LI-1', serviceCode: 'office_visit', description: 'A', billedAmount: 100, status: 'paid' },
        { lineItemId: 'LI-2', serviceCode: 'lab_test', description: 'B', billedAmount: 50, status: 'denied' }
      ]
    });

    expect(claim.status).toBe('paid');
    expect(claim.approvedLineItemCount).toBe(1);
  });
});
