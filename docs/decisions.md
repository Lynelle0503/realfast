# Decisions And Trade-Offs

This document explains what was built, what was intentionally left out of v1, and which assumptions shape the current implementation.

## What I Built

### Core Domain

- Members with multiple policies.
- Member-owned policies with explicit `coverageRules`.
- Claims with multiple line items.
- Line-level decisions with normalized reason codes and member-facing text.
- Coverage accumulators stored as ledger entries.
- Claim-level disputes with optional references to denied line items and a minimal resolution workflow.

### Core Workflow

- Claim submission in `submitted`.
- Explicit adjudication step.
- Manual-review routing for partial-payment edge cases.
- Explicit manual-review resolution.
- Line-item payment recording.
- Dispute resolution as `upheld` or `overturned`.
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

### Simplification: Billed Amount Equals Allowed Amount

The adjudicator uses `billedAmount` as the allowed amount for v1.

Why:

- Avoids introducing a separate pricing or contract model.

Cost:

- It skips an important real-world adjudication step.

### Simplification: Claim-Level Default Plus Line-Level Service Dates

The system stores `dateOfService` on the claim as a submission default and also persists `dateOfService` on each line item. Adjudication uses the line-item date when present and falls back to the claim-level default.

Why:

- It supports mixed-date claims without removing the simpler claim-level submission flow.

Cost:

- There is still no separate service date per diagnosis or per provider segment, and claim summaries still surface the claim-level default date.

### Simplification: Minimal Dispute Resolution

The system now supports `open -> upheld` and `open -> overturned`.

Why:

- It turns disputes into an actual workflow while staying small enough for a take-home assignment.

Cost:

- There is still no appeals queue, no reviewer identity, and no payment clawback flow.

## What I Did Not Build

- Eligibility verification.
- Out-of-network or provider contract logic.
- Allowed amount pricing.
- Prior authorization or medical necessity review.
- Automatic accumulator reversals for already-posted paid lines.
- Authentication and authorization.
- Background jobs or asynchronous workflow orchestration.
- Full CRUD administration for policies, claims, and disputes.

## Important Current Assumptions

- `serviceCode` is the only coverage match key.
- `coinsurancePercent: 80` means the insurer pays 80% after deductible.
- Only `policy_year` benefit periods exist.
- Yearly dollar cap usage accumulates against insurer-paid dollars.
- Visit cap usage increments by one per approved covered line.
- Member out-of-pocket usage is tracked with `member_oop_applied`.
- Deductible usage is tracked with `deductible_applied`.
- Claim adjudication is explicit and does not happen automatically on claim creation.
- The local UI is a demo operator surface, not a production-grade frontend.

## Known Gaps Between Model And Implementation

These are the places where the current model is ahead of the actual adjudicator.

### Dispute Overturn Is Intentionally Narrow

Overturning a dispute requires referenced denied line items and re-runs those lines through the normal adjudication rules on the original claim. That keeps coverage, policy-active, caps, and manual-review behavior consistent with the main adjudication path, but it is still not a full appeals subsystem.

## Why This Shape Still Works For The Assignment

The assignment emphasized domain decomposition, rule representation, state management, edge-case thinking, and explanation capability. This implementation addresses those signals by:

- modeling a clear domain with explicit states
- implementing real adjudication behavior, not just static CRUD
- handling mixed claim outcomes, service-date validation, manual-review routing, and dispute resolution
- explaining denials with normalized codes plus stored member-facing text that now includes service and cap context
- exposing the workflow through multiple surfaces and tests

It is intentionally a strong v1, not a complete insurance core system.
