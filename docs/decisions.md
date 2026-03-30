# Decisions

This document records what has been defined so far for the Claims Processing System, what assumptions currently shape the design, and what has not yet been built out in detail.

## What We Have Defined

- A member can have multiple policies.
- Each policy has its own coverage rules, including covered services, limits, and deductibles.
- A claim belongs to exactly one policy.
- For now, a member can have only one claim on a particular policy.
- Coverage is matched by `serviceCode` for v1.
- Policy coverage rules use explicit `serviceRules` instead of a simple `coveredServices` list.
- Service rules may define both dollar caps and visit caps.
- Benefit usage resets by policy year using the policy effective-date anniversary.
- Claims are resolved at the line-item level first, then rolled up to a claim-level status.
- Once all line items are resolved, the claim may be marked `approved` and should expose `approvedLineItemCount`.
- The v1 API layer is defined as a REST JSON contract with explicit action endpoints for adjudication, manual-review resolution, payment, and disputes.

## Assumptions

- Each claim line item adjudicates against the policy `serviceRule` with the same `serviceCode`.
- Deductible and coinsurance are policy-level defaults for v1 and are not overridden per service.
- `coinsurancePercent: 80` means the insurer pays 80% of the allowed amount after deductible.
- Service rules may include both `yearlyDollarCap` and `yearlyVisitCap`.
- `null` means no cap of that type applies for the service.
- Yearly cap usage accumulates against the insurer paid amount, not the billed amount.
- `benefitPeriod: "policy_year"` means caps reset on the policy effective-date anniversary, not on January 1 unless the policy starts on January 1.
- Usage counts only when a line item is approved.
- One approved covered line item consumes one visit for visit-based caps.
- Usage should be tracked through a ledger-style accumulator so reversals and disputes can post offsetting adjustments.
- If a limit is nearly exhausted and adjudication would result in a partial payment, the line item should be routed to manual review instead of being auto-approved with a reduced payment.
- If any line item remains unresolved, the claim stays in `under_review`.
- If any line item has decision `manual_review`, the claim status must be `under_review`.
- Once all line items are resolved, the claim can be marked `approved` even if some line items were denied.
- `approvedLineItemCount` records how many line items were approved on the finalized claim.
- Denied line items should use a normalized reason catalog with plain-language member-facing text.
- If a denial is caused by a cap, the member-facing explanation should say that the policy limit was exceeded.
- Manual review should be communicated as pending review, not as a denial.

## State Machine Decisions

- Line items own adjudication and payment progression.
- Claims own aggregate workflow status.
- Claim payment status is derived from line-item payment states.

### Claim State Machine

Claim states:

- `submitted`
- `under_review`
- `approved`
- `paid`

Claim transitions:

- `submitted -> under_review`
- `under_review -> approved`
- `approved -> paid`

Claim rollup rules:

- If any line item is unresolved, the claim status is `under_review`.
- If any line item is `manual_review`, the claim status is `under_review`.
- If all line items are resolved, the claim status is `approved`.
- If all approved line items are paid, the claim status is `paid`.
- Claim `approved` means adjudication is complete, not that every line item was approved.

### Line Item State Machine

Line item states:

- `submitted`
- `approved`
- `denied`
- `manual_review`
- `paid`

Line item transitions:

- `submitted -> approved`
- `submitted -> denied`
- `submitted -> manual_review`
- `manual_review -> approved`
- `manual_review -> denied`
- `approved -> paid`

Line item rules:

- `manual_review` is a pending state, not a denial.
- `denied` does not transition to `paid`.
- Payment is tracked at the line-item level for v1 and rolled up to the claim.

## Reference Example

### Member

```json
{
  "memberId": "MEM-1001",
  "fullName": "Aarav Mehta",
  "dateOfBirth": "1988-07-14"
}
```

### Policy

```json
{
  "policyId": "POL-2001",
  "memberId": "MEM-1001",
  "policyType": "Health PPO",
  "effectiveDate": "2026-01-01",
  "coverageRules": {
    "benefitPeriod": "policy_year",
    "deductible": 500,
    "coinsurancePercent": 80,
    "annualOutOfPocketMax": 3000,
    "serviceRules": [
      {
        "serviceCode": "office_visit",
        "covered": true,
        "yearlyDollarCap": 1000,
        "yearlyVisitCap": 10
      },
      {
        "serviceCode": "lab_test",
        "covered": true,
        "yearlyDollarCap": 500,
        "yearlyVisitCap": null
      },
      {
        "serviceCode": "prescription",
        "covered": false,
        "yearlyDollarCap": null,
        "yearlyVisitCap": null
      }
    ]
  }
}
```

### Claim

```json
{
  "claimId": "CLM-3001",
  "memberId": "MEM-1001",
  "policyId": "POL-2001",
  "provider": {
    "providerId": "PRV-501",
    "name": "CityCare Clinic"
  },
  "diagnosisCodes": [
    "J02.9"
  ],
  "status": "submitted",
  "approvedLineItemCount": 0,
  "lineItems": [
    {
      "lineItemId": "LI-1",
      "serviceCode": "office_visit",
      "description": "Primary care consultation",
      "billedAmount": 150
    },
    {
      "lineItemId": "LI-2",
      "serviceCode": "lab_test",
      "description": "Rapid strep test",
      "billedAmount": 80
    }
  ]
}
```

Each claim line item is adjudicated by matching its `serviceCode` to the corresponding policy `serviceRule`.

### Denial And Review Reason Catalog

```json
[
  {
    "reasonCode": "SERVICE_NOT_COVERED",
    "decision": "denied",
    "memberText": "This service is not covered under your policy."
  },
  {
    "reasonCode": "YEARLY_CAP_EXCEEDED",
    "decision": "denied",
    "memberText": "This service was denied because you have already used the yearly coverage limit allowed by your policy."
  },
  {
    "reasonCode": "VISIT_CAP_EXCEEDED",
    "decision": "denied",
    "memberText": "This service was denied because you have already used the number of visits allowed by your policy for this benefit period."
  },
  {
    "reasonCode": "MISSING_INFORMATION",
    "decision": "denied",
    "memberText": "We could not process this service because required claim information is missing."
  },
  {
    "reasonCode": "POLICY_NOT_ACTIVE",
    "decision": "denied",
    "memberText": "This service was denied because the policy was not active on the date of service."
  },
  {
    "reasonCode": "MANUAL_REVIEW_REQUIRED",
    "decision": "manual_review",
    "memberText": "This service is still under review because it needs additional review before a final decision can be made."
  }
]
```

For denied lines, the system should store both a `reasonCode` and a member-facing `reasonText`, plus a default dispute-oriented next step when applicable.

### Mixed Outcome Example

```json
{
  "claimId": "CLM-4001",
  "status": "under_review",
  "approvedLineItemCount": 3,
  "lineDecisions": [
    { "lineItemId": "LI-1", "decision": "approved" },
    { "lineItemId": "LI-2", "decision": "approved" },
    { "lineItemId": "LI-3", "decision": "approved" },
    {
      "lineItemId": "LI-4",
      "decision": "denied",
      "reasonCode": "SERVICE_NOT_COVERED",
      "reasonText": "This service is not covered under your policy.",
      "memberNextStep": "You can dispute this decision if you believe it should be covered."
    },
    {
      "lineItemId": "LI-5",
      "decision": "manual_review",
      "reasonCode": "MANUAL_REVIEW_REQUIRED",
      "reasonText": "This service is still under review because it needs additional review before a final decision can be made."
    }
  ]
}
```

If any line item is in `manual_review`, the claim must remain `status: "under_review"`. If every line item is resolved, the same claim can move to `status: "approved"` while still showing `approvedLineItemCount: 3`.

### State Machine Example

```json
{
  "claimId": "CLM-5001",
  "status": "under_review",
  "approvedLineItemCount": 2,
  "lineItems": [
    { "lineItemId": "LI-1", "status": "approved" },
    { "lineItemId": "LI-2", "status": "denied" },
    { "lineItemId": "LI-3", "status": "manual_review" }
  ]
}
```

This claim remains `under_review` because `LI-3` is still in `manual_review`. Once `LI-3` resolves to either `approved` or `denied`, the claim can move to `approved`. Once all approved line items are paid, the claim can move to `paid`.

### Coverage Accumulator Example

```json
{
  "memberId": "MEM-1001",
  "policyId": "POL-2001",
  "serviceCode": "office_visit",
  "benefitPeriodStart": "2026-01-01",
  "benefitPeriodEnd": "2026-12-31",
  "metricType": "dollars_paid",
  "delta": 120,
  "source": "claim_line_item",
  "sourceId": "LI-1",
  "status": "posted"
}
```

The accumulator should be keyed by member, policy, service, metric type, and policy-year window so the system can compute used and remaining benefits during adjudication.

## What Has Not Been Defined Yet

- Exact dispute, reversal, and reopened-claim state transitions beyond the v1 state machine above.
- Whether diagnosis codes, provider network, or prior authorization will affect coverage in later versions.
- Whether visit quantity should eventually become an explicit line-item field instead of defaulting to one visit per approved line item.
- The exact persistence schema and service implementation behind the API contract.
