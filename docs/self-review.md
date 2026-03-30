# Self-Review

This project delivers a working, explainable v1 claims processing system with multiple ways to interact with it. The strongest parts of the submission are the domain decomposition, the separation between domain/application/infrastructure layers, and the fact that the core workflow is executable end to end through tests, CLI commands, the API, and the local UI.

## What Is Good

- The core domain is small and understandable.
  Members, policies, claims, line items, decisions, accumulators, and disputes are modeled as separate concepts with fairly clean boundaries.
- Claim and line-item state handling is explicit.
  Line items own adjudication and payment progression, and claim status is derived from line-item state rather than set manually.
- The adjudication logic is deterministic and easy to follow.
  Coverage matching, deductible application, coinsurance, visit caps, dollar caps, and manual-review routing all happen in one well-tested service.
- The accumulator model is a good v1 foundation.
  Usage is tracked as ledger-style entries instead of a mutable running total, which gives a better path for future reversals and auditability.
- The project is test-backed.
  There are unit tests for domain logic and integration tests for persistence, HTTP, CLI, seeding, and the local UI server.
- The local UI improves explainability.
  It shows claim state transitions, line-item decisions, and now also surfaces raw JSON for singleton policy and dispute endpoints.

## What Is Rough

- The domain is still narrower than a realistic claims system.
  There is no date of service, allowed amount, provider network logic, medical necessity review, eligibility checks, or appeals workflow.
- Some modeled fields are not yet enforced.
  `annualOutOfPocketMax` exists on the policy but is not currently applied during adjudication.
- The reason catalog is broader than the implemented adjudicator.
  `MISSING_INFORMATION` and `POLICY_NOT_ACTIVE` exist as reason codes, but the current claim model does not contain the fields needed for those outcomes to be produced.
- Claim creation is artificially constrained.
  The code only allows one claim per member per policy, which simplifies the demo but is not realistic for production claims processing.
- Disputes are only captured, not resolved.
  The system can open and view disputes, but there is no dispute lifecycle, no appeals adjudication, and no accumulator reversal logic tied to dispute outcomes.
- Some explanations are still generic.
  The system stores normalized reason text, but member-facing denial text does not yet include dynamic service names or specific policy cap values inside the persisted decision itself.

## Risks I Would Flag In A Real Review

- Using adjudication time instead of service date for benefit-period calculations is a meaningful domain shortcut.
- Manual review approval can produce a partial payout, but that path is handled as a direct operator decision rather than a richer reviewer workflow.
- The local UI is intentionally simple and is not a substitute for a hardened frontend or back-office operations tool.
- There is no authentication, authorization, audit identity, or concurrency control.

## If I Had More Time

- Add service dates to claim lines and use them for policy-active and benefit-period decisions.
- Enforce out-of-pocket max and explicitly model member-paid deductible history.
- Remove the one-claim-per-policy restriction and support repeated claims over time.
- Expand disputes into an appeals workflow with statuses and adjudication outcomes.
- Make explanation text more dynamic and member-friendly while preserving reason-code normalization.
- Add README examples for sample payloads and a richer API walkthrough.

## Overall Assessment

For a one-day take-home, this is a solid v1 with a real domain model, executable workflow, and meaningful edge-case handling around caps and manual review. The code is much stronger as a foundation for discussion and extension than as a finished insurance system, which is acceptable for the assignment and consistent with the stated next-round expectation that the system would be extended together.
