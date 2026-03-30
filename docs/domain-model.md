# Domain Model

This document describes the domain model implemented in the current v1 claims processing system. It is intentionally grounded in the code that exists in [app/](/Users/lynelle/Documents/CodeSpace/RealFast/app), not a larger future-state insurance platform.

## System Overview

The system models a reimbursement workflow with these core concepts:

- A `Member` owns one or more `Policy` records.
- A `Policy` contains `coverageRules` and `serviceRules`.
- A `Claim` is submitted under exactly one policy.
- A `Claim` contains one or more `ClaimLineItem` records.
- Each line item produces a `LineDecision` when adjudicated.
- Approved covered usage is recorded through `AccumulatorEntry` ledger rows.
- A `Dispute` can be opened against a claim, with optional references to specific denied line items.

The implementation exposes this model through:

- a CLI
- a REST API
- a local web UI backed by the same application services

## Entities

### Member

A member is the insured person.

Fields:

- `memberId`
- `fullName`
- `dateOfBirth`

Example:

```json
{
  "memberId": "MEM-0001",
  "fullName": "Aarav Mehta",
  "dateOfBirth": "1988-07-14"
}
```

### Policy

A policy belongs to exactly one member and defines the default adjudication rules for claims submitted under it.

Fields:

- `policyId`
- `memberId`
- `policyType`
- `effectiveDate`
- `coverageRules`

Example:

```json
{
  "policyId": "POL-0001",
  "memberId": "MEM-0001",
  "policyType": "Health PPO",
  "effectiveDate": "2026-01-01",
  "coverageRules": {
    "benefitPeriod": "policy_year",
    "deductible": 0,
    "coinsurancePercent": 80,
    "annualOutOfPocketMax": 3000,
    "serviceRules": [
      {
        "serviceCode": "office_visit",
        "covered": true,
        "yearlyDollarCap": 180,
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

### Coverage Rules

Coverage rules are stored inline on the policy.

Fields:

- `benefitPeriod`
- `deductible`
- `coinsurancePercent`
- `annualOutOfPocketMax`
- `serviceRules`

Notes:

- Only `policy_year` is supported for `benefitPeriod` in v1.
- `annualOutOfPocketMax` is modeled but not currently enforced during adjudication.
- Deductible and coinsurance are policy-level defaults for all services in v1.

### Service Rule

A service rule is the unit of benefit definition used during adjudication.

Fields:

- `serviceCode`
- `covered`
- `yearlyDollarCap`
- `yearlyVisitCap`

Notes:

- Coverage is matched by exact `serviceCode`.
- `null` means no cap of that type is present.
- Both a dollar cap and a visit cap may be present on the same service.

### Claim

A claim is submitted by a member under one policy. It is the aggregate workflow object that rolls up line-item status.

Fields:

- `claimId`
- `memberId`
- `policyId`
- `provider`
- `diagnosisCodes`
- `status`
- `approvedLineItemCount`
- `lineItems`
- `lineDecisions`

Example:

```json
{
  "claimId": "CLM-0001",
  "memberId": "MEM-0001",
  "policyId": "POL-0001",
  "provider": {
    "providerId": "PRV-9001",
    "name": "Downtown Clinic"
  },
  "diagnosisCodes": ["J02.9"],
  "status": "submitted",
  "approvedLineItemCount": 0,
  "lineItems": [
    {
      "lineItemId": "LI-0001",
      "serviceCode": "office_visit",
      "description": "Primary care consultation",
      "billedAmount": 150,
      "status": "submitted"
    }
  ],
  "lineDecisions": []
}
```

### Claim Line Item

A claim line item is the unit of adjudication.

Fields:

- `lineItemId`
- `serviceCode`
- `description`
- `billedAmount`
- `status`

Important v1 note:

- There is no service-date field on the claim or line item yet.

### Line Decision

A line decision records the adjudication outcome for a single claim line.

Fields:

- `lineItemId`
- `decision`
- `reasonCode`
- `reasonText`
- `memberNextStep`
- `payerAmount`
- `memberResponsibility`

Example:

```json
{
  "lineItemId": "LI-0002",
  "decision": "denied",
  "reasonCode": "YEARLY_CAP_EXCEEDED",
  "reasonText": "This service was denied because you have already used the yearly coverage limit allowed by your policy.",
  "memberNextStep": "You can dispute this decision if you believe the limit was applied incorrectly.",
  "payerAmount": 0,
  "memberResponsibility": 80
}
```

### Accumulator Entry

Accumulator entries track approved usage as ledger rows.

Fields:

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

Two metrics are used:

- `dollars_paid`
- `visits_used`

Current behavior:

- Dollar usage accumulates based on insurer-paid amount.
- Visit usage increments by `1` for each approved covered line.
- Only approved lines generate accumulator entries.
- The enum supports `posted` and `reversed`, but v1 currently only posts entries.

### Dispute

A dispute is a lightweight claim-level challenge record.

Fields:

- `disputeId`
- `claimId`
- `memberId`
- `status`
- `reason`
- `note`
- `referencedLineItemIds`

Current v1 note:

- Only `open` disputes are modeled today.

## Relationships

- One member can own many policies.
- One policy belongs to one member.
- One policy contains many service rules.
- One member can have many claims overall.
- One claim belongs to one member and one policy.
- One claim has many claim line items.
- One claim has zero or more line decisions.
- One approved line item produces two accumulator entries in the current implementation:
  one for `dollars_paid` and one for `visits_used`.
- One claim can have zero or more disputes.

Important implementation-specific rule:

- The current command layer only allows one claim per member per policy at a time. This is a deliberate v1 simplification, not a domain truth I would keep in a production system.

## Adjudication Model

The adjudication service processes each submitted line item in order.

### Matching Rule

- Find the policy `serviceRule` whose `serviceCode` matches the line item `serviceCode`.

### If No Covered Rule Exists

- Deny the line with `SERVICE_NOT_COVERED`.

### If Visit Cap Is Exhausted

- Deny the line with `VISIT_CAP_EXCEEDED`.

### Otherwise

1. Treat `billedAmount` as the allowed amount.
2. Apply remaining policy deductible.
3. Apply policy coinsurance to the covered amount.
4. Check the yearly dollar cap for that service.

Outcomes:

- If no dollar cap remains, deny with `YEARLY_CAP_EXCEEDED`.
- If the normal payer amount would exceed the remaining dollar cap, route to `manual_review`.
- Otherwise approve the line and post accumulator entries.

### Manual Review Resolution

Manual review is resolved explicitly by an operator action:

- `manual_review -> denied`
- `manual_review -> approved`

Current implementation detail:

- Manual approval can result in a capped partial payment because the reviewer path clamps payment to the remaining dollar cap rather than auto-denying the line.

## Benefit Period Model

Benefit periods are calculated from the policy `effectiveDate`.

Rules:

- Only `policy_year` is supported.
- The benefit period resets on the effective-date anniversary.
- The current implementation computes the active period using adjudication time, not date of service.

Example:

- Policy effective date: `2026-02-01`
- Adjudication date: `2026-03-30`
- Benefit period: `2026-02-01` through `2027-01-31`

## State Machines

### Claim State Machine

States:

- `submitted`
- `under_review`
- `approved`
- `paid`

Derived rollup rules:

- If any line item is still `submitted`, the claim is `under_review`.
- If any line item is `manual_review`, the claim is `under_review`.
- If every line item is resolved and at least one approved line remains unpaid, the claim is `approved`.
- If every approved line item is `paid`, the claim is `paid`.

Important implementation note:

- The claim is treated as a derived status aggregate. The code rolls it up from line items after adjudication, review resolution, and payment actions.

### Line Item State Machine

States:

- `submitted`
- `approved`
- `denied`
- `manual_review`
- `paid`

Transitions:

- `submitted -> approved`
- `submitted -> denied`
- `submitted -> manual_review`
- `manual_review -> approved`
- `manual_review -> denied`
- `approved -> paid`

Notes:

- `manual_review` is pending, not denied.
- `denied` never transitions to `paid`.
- Payment is tracked at the line-item level.

## Reason Catalog

The normalized reason catalog currently includes:

- `SERVICE_NOT_COVERED`
- `YEARLY_CAP_EXCEEDED`
- `VISIT_CAP_EXCEEDED`
- `MISSING_INFORMATION`
- `POLICY_NOT_ACTIVE`
- `MANUAL_REVIEW_REQUIRED`

Current implementation note:

- The adjudicator actively emits `SERVICE_NOT_COVERED`, `YEARLY_CAP_EXCEEDED`, `VISIT_CAP_EXCEEDED`, and `MANUAL_REVIEW_REQUIRED`.
- `MISSING_INFORMATION` and `POLICY_NOT_ACTIVE` are defined for future use but are not currently produced by the adjudication service because the model does not yet contain the required input fields.

## Process Flow Example

1. Create a member.
2. Create a policy with service rules.
3. Submit a claim with line items in `submitted`.
4. Adjudicate the claim.
5. If any line is routed to `manual_review`, resolve it explicitly.
6. Mark approved lines as paid.
7. Optionally open a dispute against denied lines.

That flow is available through:

- the CLI
- the REST API
- the local UI
