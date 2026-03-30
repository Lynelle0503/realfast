# API Layer

This document defines the v1 REST JSON API layer for the Claims Processing System. The API is designed around minimal, auditable actions and follows the domain model in [domain-model.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/domain-model.md).

Base path:

- `/api/v1`

## Design Principles

- Use resource-oriented endpoints for members, policies, claims, and disputes.
- Use explicit action endpoints for adjudication, manual review resolution, payment, and dispute resolution.
- Keep claim creation separate from adjudication.
- Return line-level decisions in claim detail responses.
- Derive claim status from line-item statuses instead of updating it independently.

## Endpoints

### Members And Policies

- `POST /api/v1/members`
  Create a member.
- `GET /api/v1/members`
  List members.
- `GET /api/v1/members/{memberId}`
  Fetch member details.
- `GET /api/v1/members/{memberId}/policies`
  List the member's policies.
- `POST /api/v1/members/{memberId}/policies`
  Create a policy for the member.
- `GET /api/v1/policies/{policyId}`
  Fetch a policy including `coverageRules` and `serviceRules`.

### Claims

- `POST /api/v1/claims`
  Create a claim in `submitted`.
- `GET /api/v1/claims/{claimId}`
  Fetch full claim detail, including line items and line decisions.
- `GET /api/v1/members/{memberId}/claims`
  List claims for a member using summary fields.
- `POST /api/v1/claims/{claimId}/adjudications`
  Adjudicate unresolved line items on the claim.
- `POST /api/v1/claims/{claimId}/line-items/{lineItemId}/review-decisions`
  Resolve a line item in `manual_review`.
- `POST /api/v1/claims/{claimId}/payments`
  Mark approved line items as paid.

### Disputes

- `POST /api/v1/claims/{claimId}/disputes`
  Open a claim-level dispute.
- `GET /api/v1/claims/{claimId}/disputes`
  List disputes for a claim.
- `GET /api/v1/disputes/{disputeId}`
  Fetch dispute details.
- `POST /api/v1/disputes/{disputeId}/resolution`
  Resolve an open dispute as `upheld` or `overturned`.

## Workflow By Minimal API Calls

### Member Has Policy With Coverage Rules

1. `POST /api/v1/members`
2. `POST /api/v1/members/{memberId}/policies`
3. `GET /api/v1/policies/{policyId}`

### Member Submits A Claim

1. `POST /api/v1/claims`

### System Adjudicates The Claim

1. `POST /api/v1/claims/{claimId}/adjudications`
2. Optional:
   `POST /api/v1/claims/{claimId}/line-items/{lineItemId}/review-decisions`

### System Pays Approved Line Items

1. `POST /api/v1/claims/{claimId}/payments`

### Member Disputes A Decision

1. `POST /api/v1/claims/{claimId}/disputes`
2. Optional:
   `POST /api/v1/disputes/{disputeId}/resolution`

## Response Shape Expectations

### Claim

- `claimId`
- `memberId`
- `policyId`
- `provider`
- `dateOfService`
- `diagnosisCodes`
- `status`
- `approvedLineItemCount`
- `lineItems`
- `lineDecisions`

### Claim Line Item

- `lineItemId`
- `serviceCode`
- `description`
- `billedAmount`
- `dateOfService`
- `status`

### Line Decision

- `lineItemId`
- `decision`
- `reasonCode`
- `reasonText`
- `memberNextStep`
- `payerAmount`
- `memberResponsibility`

### Dispute

- `disputeId`
- `claimId`
- `memberId`
- `status`
- `reason`
- `note`
- `referencedLineItemIds`
- `resolvedAt`
- `resolutionNote`

## Status Rules

- Claim statuses:
  `submitted`, `under_review`, `approved`, `paid`
- Line-item statuses:
  `submitted`, `approved`, `denied`, `manual_review`, `paid`
- If any line item is unresolved or in `manual_review`, claim status is `under_review`.
- If all line items are resolved, claim status is `approved`.
- If all approved line items are paid, claim status is `paid`.

## Notes

- Adjudication is explicit and does not run automatically on claim creation.
- New claim submission requires claim-level `dateOfService`; each line item may optionally override it with its own `dateOfService`.
- Disputes are claim-level in v1, with optional references to specific line items.
- Overturning a dispute is limited to disputes that reference denied line items.
- Payment is tracked at the line-item level and rolled up to the claim.
- The machine-readable API contract is defined in [api/openapi.yaml](/Users/lynelle/Documents/CodeSpace/RealFast/api/openapi.yaml).
