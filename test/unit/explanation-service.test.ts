import { describe, expect, it } from 'vitest';

import { getMemberNextStep, getReasonText } from '../../src/core/application/services/explanation-service.js';

describe('explanation service', () => {
  it('maps denial reasons to member-facing text', () => {
    expect(getReasonText('SERVICE_NOT_COVERED')).toContain('not covered');
    expect(getReasonText('YEARLY_CAP_EXCEEDED')).toContain('yearly coverage limit');
  });

  it('returns default next steps for denials and none for manual review', () => {
    expect(getMemberNextStep('SERVICE_NOT_COVERED')).toContain('dispute');
    expect(getMemberNextStep('MANUAL_REVIEW_REQUIRED')).toBeNull();
  });
});
