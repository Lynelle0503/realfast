# Claims Processing System

Build a **Claims Processing System** for an insurance company.

## Context

An insurance company processes claims like this:

- A **member** has a **policy** with coverage rules (what's covered, limits, deductibles)
- The member incurs an expense and submits a **claim** with line items
- Claims contain member information, diagnosis codes, provider details, and amounts
- The system must **adjudicate** each line item: Is it covered? How much do we pay?
- Claims move through states: submitted -> under review -> approved/denied -> paid
- Members can dispute decisions

## Core Domain Objects

### Member

- A member can have multiple policies.
- A member submits claims for reimbursement under a specific policy.

Example:

```json
{
  "memberId": "MEM-1001",
  "fullName": "Aarav Mehta",
  "dateOfBirth": "1988-07-14"
}
```

### Policy

- A policy belongs to one member.
- Each policy has coverage rules that define deductible, coinsurance, out-of-pocket limits, and per-service coverage rules.
- Coverage resets by policy year, based on the policy effective-date anniversary.

Example:

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

- A claim belongs to exactly one policy.
- A claim contains one or more line items.
- Each line item is adjudicated against the matching policy `serviceRule` using `serviceCode`.
- The claim stays `under_review` while any line item is unresolved.
- If any line item has decision `manual_review`, the claim status must be `under_review`.
- Once all line items are resolved, the claim may be marked `approved` even if some line items were denied, and a separate count should show how many line items were approved.

Example:

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

### Line Decision

- Each line item should produce a structured decision record.
- Decisions should include both machine-readable reason codes and member-facing explanation text.
- Member-facing explanations should be plain language and should mention the policy cap when a limit caused the denial.

Example:

```json
{
  "lineItemId": "LI-4",
  "decision": "denied",
  "reasonCode": "YEARLY_CAP_EXCEEDED",
  "reasonText": "This service was denied because you have already used the yearly coverage limit allowed by your policy.",
  "memberNextStep": "You can dispute this decision if you believe the limit was applied incorrectly."
}
```

### Coverage Accumulator

- The system tracks benefit usage per member, policy, service, and policy year.
- Dollar usage accumulates from insurer-paid amounts only.
- Visit usage accumulates as one visit per approved covered line item.
- Partial payments caused by an almost exhausted limit are sent to manual review instead of being auto-approved.

Example:

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

## Adjudication Assumptions

- Coverage is matched by `serviceCode` for v1.
- Deductible and coinsurance are policy-level defaults for v1.
- `coinsurancePercent: 80` means the insurer pays 80% of the allowed amount after deductible.
- Service rules may include both `yearlyDollarCap` and `yearlyVisitCap`.
- `null` means no cap of that type applies.
- Yearly cap usage accumulates against insurer-paid dollars, not billed amounts.
- Usage is counted only for approved line items.
- Reversals and disputes should be represented as ledger adjustments, not by overwriting prior usage.
- If a line item would require a partial payment because a limit is nearly exhausted, route it to manual review.
- If any line item is unresolved, the overall claim remains `under_review`.
- If any line item has decision `manual_review`, the overall claim status must be `under_review`.
- Once all line items are resolved, the overall claim status can be `approved`, and `approvedLineItemCount` should show how many line items were approved.
- Denial communication should come from a normalized reason catalog, not ad hoc freeform text.
- Manual review communication should not be presented as a denial.

## State Machines

### Claim States

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
- If any line item is in `manual_review`, the claim status is `under_review`.
- If all line items are resolved, the claim status is `approved`.
- If all approved line items are paid, the claim status is `paid`.
- Claim status is derived from line-item statuses and should not be set independently of the rollup rules.

### Line Item States

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

Line item state notes:

- `manual_review` is a pending state, not a denial.
- `denied` does not transition to `paid`.
- Payment is tracked at the line-item level for v1.

## Denial And Review Reason Catalog

- `SERVICE_NOT_COVERED`
  Member text: "This service is not covered under your policy."
- `YEARLY_CAP_EXCEEDED`
  Member text: "This service was denied because you have already used the yearly coverage limit allowed by your policy."
- `VISIT_CAP_EXCEEDED`
  Member text: "This service was denied because you have already used the number of visits allowed by your policy for this benefit period."
- `MISSING_INFORMATION`
  Member text: "We could not process this service because required claim information is missing."
- `POLICY_NOT_ACTIVE`
  Member text: "This service was denied because the policy was not active on the date of service."
- `MANUAL_REVIEW_REQUIRED`
  Member text: "This service is still under review because it needs additional review before a final decision can be made."

For denied lines, the member-facing explanation should include:

- what service was affected
- a short plain-language reason
- a note about the policy cap when a cap caused the denial
- the default next step to dispute the decision

## State Machine Example

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

In this example, the claim remains `under_review` because one line item is still in `manual_review`, even though two line items are already resolved.

## Example Mixed Adjudication Outcome

```json
{
  "claimId": "CLM-4001",
  "status": "under_review",
  "approvedLineItemCount": 3,
  "lineDecisions": [
    {
      "lineItemId": "LI-1",
      "decision": "approved"
    },
    {
      "lineItemId": "LI-2",
      "decision": "approved"
    },
    {
      "lineItemId": "LI-3",
      "decision": "approved"
    },
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

If `LI-5` is still in `manual_review`, the claim remains `under_review`. Once `LI-5` is resolved, the claim can move to `approved` and keep `approvedLineItemCount` in sync with the finalized line decisions.
