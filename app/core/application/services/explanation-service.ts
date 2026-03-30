import type { ReasonCode } from '../../domain/enums.js';

const REASON_TEXT: Record<ReasonCode, string> = {
  SERVICE_NOT_COVERED: 'This service is not covered under your policy.',
  YEARLY_CAP_EXCEEDED:
    'This service was denied because you have already used the yearly coverage limit allowed by your policy.',
  VISIT_CAP_EXCEEDED:
    'This service was denied because you have already used the number of visits allowed by your policy for this benefit period.',
  MISSING_INFORMATION: 'We could not process this service because required claim information is missing.',
  POLICY_NOT_ACTIVE: 'This service was denied because the policy was not active on the date of service.',
  MANUAL_REVIEW_REQUIRED:
    'This service is still under review because it needs additional review before a final decision can be made.'
};

const NEXT_STEP_TEXT: Partial<Record<ReasonCode, string>> = {
  SERVICE_NOT_COVERED: 'You can dispute this decision if you believe it should be covered.',
  YEARLY_CAP_EXCEEDED: 'You can dispute this decision if you believe the limit was applied incorrectly.',
  VISIT_CAP_EXCEEDED: 'You can dispute this decision if you believe the visit limit was applied incorrectly.',
  MISSING_INFORMATION: 'You can dispute this decision if you believe the claim included the required information.',
  POLICY_NOT_ACTIVE: 'You can dispute this decision if you believe the policy should have been active.'
};

export function getReasonText(reasonCode: ReasonCode): string {
  return REASON_TEXT[reasonCode];
}

export function getMemberNextStep(reasonCode: ReasonCode): string | null {
  return NEXT_STEP_TEXT[reasonCode] ?? null;
}
