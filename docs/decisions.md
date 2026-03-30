# Decisions And Trade-Offs

This document explains what was built, what was intentionally left out of v1, and which assumptions shape the current implementation.

## What I Built

### Core Domain

- Members with multiple policies.
- Member-owned policies with explicit `coverageRules`.
- Claims with multiple line items.
- Line-level decisions with normalized reason codes and member-facing text.
- Coverage accumulators stored as ledger entries.
- Claim-level disputes with optional references to denied line items.

### Core Workflow

- Claim submission in `submitted`.
- Explicit adjudication step.
- Manual-review routing for partial-payment edge cases.
- Explicit manual-review resolution.
- Line-item payment recording.
- Claim status rollup based on line-item states.

### Delivery Surfaces

- CLI for creating data and walking the workflow.
- REST API under `/api/v1`.
- Local web UI served from the same Node process.
- OpenAPI contract in [api/openapi.yaml](/Users/lynelle/Documents/CodeSpace/RealFast/api/openapi.yaml).

### Testing

- Unit tests for adjudication, explanations, benefit periods, rollup logic, and application commands.
- Integration tests for SQLite persistence, seeding, CLI flows, API flows, and the local UI server.

## Modeling Decisions

### 1. Coverage Rules Live On The Policy

I chose to keep coverage rules inline on the policy as structured JSON-friendly objects rather than invent a rule DSL. That keeps the system easy to explain and easy to mutate for a take-home assignment.

Why:

- Fast to build.
- Easy to serialize through API, CLI, SQLite, and tests.
- Enough structure to model the required caps and coverage flags.

Trade-off:

- It is less flexible than a dedicated rule engine or versioned benefit configuration model.

### 2. Adjudication Is Service-Code Driven

The current implementation matches each claim line to a policy rule by exact `serviceCode`.

Why:

- It satisfies the prompt cleanly for v1.
- It keeps reasoning deterministic and visible in tests.

Trade-off:

- Real claims adjudication usually depends on service date, diagnosis, eligibility, provider context, network status, and allowed amounts.

### 3. Accumulators Are Ledger Rows, Not Mutable Totals

I modeled coverage usage as append-only style entries with `metricType`, `delta`, and `sourceId`.

Why:

- Better auditability.
- Easier future support for reversals and adjustments.
- Natural fit for claim-line-driven benefit usage.

Trade-off:

- The read path must aggregate rows to derive usage.

### 4. Claim Status Is Derived

Claim status is not independently edited by users. It is rolled up from line-item state.

Why:

- Keeps workflow logic consistent.
- Avoids invalid combinations like a fully unresolved claim marked as `approved`.

Trade-off:

- You need to reason about both claim state and line-item state together.

### 5. Manual Review Is Explicit

When a line would otherwise need a partial automatic payment due to a nearly exhausted dollar cap, the system moves that line to `manual_review`.

Why:

- It matches the assignment’s assumption.
- It keeps the auto-adjudication path conservative.

Trade-off:

- The manual-review resolution flow is intentionally simple and not a full reviewer work queue.

## Scope Cuts And Simplifications

These are deliberate v1 constraints.

### Simplification: One Claim Per Member Per Policy

The current `createClaim` command prevents a second claim from being created for the same member-policy pair.

Why:

- It simplified the first workflow and the demo UI.

Cost:

- It is unrealistic for a real claims system and should be removed in a follow-up version.

### Simplification: Billed Amount Equals Allowed Amount

The adjudicator uses `billedAmount` as the allowed amount for v1.

Why:

- Avoids introducing a separate pricing or contract model.

Cost:

- It skips an important real-world adjudication step.

### Simplification: No Service Dates

Claims and claim lines do not currently store service dates.

Why:

- Reduced the number of required inputs for the first version.

Cost:

- The system cannot truly evaluate policy-active-at-service-time logic.
- Benefit periods are computed using adjudication time rather than service date.

### Simplification: Disputes Are Capture-Only

The system can open and view disputes, but it does not resolve them or reopen claims automatically.

Why:

- The prompt only required that members can dispute decisions, not that appeals be fully implemented.

Cost:

- The workflow ends at dispute creation instead of continuing into appeals adjudication.

## What I Did Not Build

- Appeals workflow beyond opening a dispute.
- Eligibility verification.
- Service-date-aware adjudication.
- Out-of-network or provider contract logic.
- Allowed amount pricing.
- Prior authorization or medical necessity review.
- Automatic accumulator reversals.
- Authentication and authorization.
- Background jobs or asynchronous workflow orchestration.
- Full CRUD administration for policies, claims, and disputes.

## Important Current Assumptions

- `serviceCode` is the only coverage match key.
- `coinsurancePercent: 80` means the insurer pays 80% after deductible.
- Only `policy_year` benefit periods exist.
- Yearly dollar cap usage accumulates against insurer-paid dollars.
- Visit cap usage increments by one per approved covered line.
- Claim adjudication is explicit and does not happen automatically on claim creation.
- The local UI is a demo operator surface, not a production-grade frontend.

## Known Gaps Between Model And Implementation

These are the places where the current model is ahead of the actual adjudicator.

### `annualOutOfPocketMax` Is Modeled But Not Enforced

Policies store `annualOutOfPocketMax`, but the current adjudication service does not apply it.

### Some Reason Codes Are Defined But Not Produced

The reason catalog includes:

- `MISSING_INFORMATION`
- `POLICY_NOT_ACTIVE`

However, the current claim model does not yet provide the fields necessary to produce those decisions during adjudication.

### Explanation Text Is Normalized More Than Personalized

The system stores normalized reason text and next-step text, but the persisted decision record does not yet inject dynamic service names or exact policy cap values into the stored explanation.

## Why This Shape Still Works For The Assignment

The assignment emphasized domain decomposition, rule representation, state management, edge-case thinking, and explanation capability. This implementation addresses those signals by:

- modeling a clear domain with explicit states
- implementing real adjudication behavior, not just static CRUD
- handling mixed claim outcomes and manual-review routing
- explaining denials with normalized codes and member-facing text
- exposing the workflow through multiple surfaces and tests

It is intentionally a strong v1, not a complete insurance core system.
