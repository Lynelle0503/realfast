# Domain Model

This document consolidates the current domain model for the Claims Processing System, including entities, relationships, and workflow state machines.

## Entities

### Member

A member is the insured person who holds one or more policies and submits claims for reimbursement.

Core fields:

- `memberId`
- `fullName`
- `dateOfBirth`

Example:

```json
{
  "memberId": "MEM-1001",
  "fullName": "Aarav Mehta",
  "dateOfBirth": "1988-07-14"
}
```

### Policy

A policy belongs to one member and defines the coverage rules used to adjudicate claims.

Core fields:

- `policyId`
- `memberId`
- `policyType`
- `effectiveDate`
- `coverageRules`

Coverage rule fields:

- `benefitPeriod`
- `deductible`
- `coinsurancePercent`
- `annualOutOfPocketMax`
- `serviceRules`

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

### Service Rule

A service rule is a policy-scoped benefit rule matched by `serviceCode`.

Core fields:

- `serviceCode`
- `covered`
- `yearlyDollarCap`
- `yearlyVisitCap`

Notes:

- Coverage is matched by `serviceCode` for v1.
- A service rule may have both a dollar cap and a visit cap.
- `null` means no cap of that type applies.

### Claim

A claim is submitted by a member under exactly one policy and contains one or more line items.

Core fields:

- `claimId`
- `memberId`
- `policyId`
- `provider`
- `diagnosisCodes`
- `status`
- `approvedLineItemCount`
- `lineItems`

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
      "billedAmount": 150,
      "status": "submitted"
    },
    {
      "lineItemId": "LI-2",
      "serviceCode": "lab_test",
      "description": "Rapid strep test",
      "billedAmount": 80,
      "status": "submitted"
    }
  ]
}
```

### Claim Line Item

A claim line item is the unit of adjudication. Coverage, denial, manual review, and payment are decided at the line-item level.

Core fields:

- `lineItemId`
- `serviceCode`
- `description`
- `billedAmount`
- `status`

### Line Decision

A line decision stores the adjudication result for a line item and the member-facing explanation.

Core fields:

- `lineItemId`
- `decision`
- `reasonCode`
- `reasonText`
- `memberNextStep`

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

A coverage accumulator tracks how much of a policy benefit has already been used within the current policy year.

Core fields:

- `memberId`
- `policyId`
- `serviceCode`
- `benefitPeriodStart`
- `benefitPeriodEnd`
- `metricType`
- `delta`
- `source`
- `sourceId`
- `status`

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

## Relationships

- One `Member` can have many `Policy` records.
- One `Policy` belongs to one `Member`.
- One `Policy` has many `ServiceRule` records.
- One `Claim` belongs to one `Member`.
- One `Claim` belongs to one `Policy`.
- One `Claim` has many `ClaimLineItem` records.
- One `ClaimLineItem` produces zero or one final `LineDecision` in v1.
- One approved `ClaimLineItem` can produce one or more `CoverageAccumulator` entries.
- `CoverageAccumulator` entries are keyed by member, policy, service, metric type, and policy-year window.

## Adjudication Rules

- Coverage is matched by `serviceCode`.
- Deductible and coinsurance are policy-level defaults for v1.
- `coinsurancePercent: 80` means the insurer pays 80% of the allowed amount after deductible.
- Benefit limits reset on the policy effective-date anniversary using `benefitPeriod: "policy_year"`.
- Dollar usage accumulates against insurer-paid amounts, not billed amounts.
- Visit usage accumulates as one visit per approved covered line item.
- If a line item would require a partial payment because a limit is almost exhausted, route the line item to `manual_review`.
- Manual review is not a denial.

## Claim State Machine

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
- `approvedLineItemCount` records how many line items were approved on the finalized claim.

## Line Item State Machine

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
- Payment is tracked at the line-item level for v1.

## Denial And Review Catalog

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

This claim remains `under_review` because `LI-3` is still in `manual_review`. Once `LI-3` resolves to either `approved` or `denied`, the claim can move to `approved`. Once all approved line items are paid, the claim can move to `paid`.
