# Self-Review

This project delivers a working v1 claims processing system with a real adjudication path, explicit state handling, stored explanations, and multiple runnable surfaces. The strongest part of the submission is that it is not just CRUD: it has a coherent domain model, a clear workflow, and enough tests and delivery surfaces to demonstrate the design.

## What Works In My Favor

- The domain decomposition is clean and easy to explain.
  Members, policies, claims, line items, decisions, accumulators, and disputes are modeled as separate concepts, and the code mostly keeps those responsibilities from bleeding together.
- Claim status is derived instead of manually edited.
  That was the right modeling choice for the assignment because it forces consistency between line-item states and the aggregate claim state.
- The adjudication path handles meaningful edge cases.
  The service does more than check a covered flag. It applies service-code matching, service-date validation, policy-year benefit windows, deductible, coinsurance, yearly dollar caps, yearly visit caps, out-of-pocket max tracking, and manual-review routing for partial-payment edge cases.
- Denial and review outcomes are explainable.
  The implementation uses normalized reason codes plus stored member-facing text instead of ad hoc strings, which makes the behavior easier to test and easier to extend.
- The accumulator model is a good foundation.
  Usage is tracked through ledger-like entries for dollars paid, visits used, member out-of-pocket, and deductible application, which is a better shape than keeping mutable counters on the policy or claim.
- The workflow is executable end to end.
  The same application services are exposed through a CLI, HTTP API, and local UI, which makes the project easier to demo and shows that the domain model is not tightly coupled to one interface.
- The test coverage supports the design.
  There are unit tests around the core business rules and integration tests around SQLite persistence, CLI flows, API flows, seeding, and the local UI server.

## Pending Gaps

- The pricing model is intentionally simplified.
  The adjudicator uses billed amount as the allowed amount, so there is still no fee schedule, provider contract pricing, network logic, or allowed-amount calculation step.
- Policy activity is too simple for a real system.
  A policy is effectively considered active forever once the service date is on or after the effective date. There is no termination date, cancellation, reinstatement, or versioned eligibility model.
- Input validation is still too permissive.
  The system validates shapes and required presence in many places, but it still allows domain-invalid inputs like negative billed amounts, unrealistic percentage values, malformed date strings, and duplicate or contradictory service rules.
- Dispute resolution is intentionally narrow.
  An overturned dispute re-runs denied lines through normal adjudication rather than applying a reviewer override, so it is still not a true appeals workflow with evidence, reviewer identity, queueing, or controlled exception handling.
- Ledger reversals are modeled but not truly used.
  The accumulator design points toward auditability, but v1 still lacks automated reversal entries, payment clawbacks, and broader retroactive adjustment flows.
- Operational concerns are mostly out of scope.
  There is no authentication, authorization, concurrency control, reviewer audit identity, background workflow orchestration, or production-grade observability.
- The UI is a demo surface, not an operations tool.
  It is helpful for walkthroughs, but it is not a hardened back-office experience with queue management, filtering, or role-aware workflows.

## Risks I Would Flag In A Real Review

- Manual review approval can produce a partial payout, but that path is still a direct operator action rather than a richer review workflow with explicit rationale capture.
- The dispute subsystem can change dispute status without representing the full downstream financial consequences that a real appeals process would require.
- The database schema stores the current model well enough for v1, but it does not yet encode many business invariants at the database level.

## If I Had More Time

- Add stronger domain validation for money, dates, percent ranges, and policy/service-rule integrity.
- Expand disputes into a fuller appeals workflow with reviewer assignment, evidence, overrides, and payment adjustments.
- Introduce an allowed-amount model so adjudication is not based directly on billed amount.
- Add audit identity and stronger operational safeguards around manual review and payment actions.

## Overall Assessment

The code shows deliberate modeling decisions, handles mixed adjudication outcomes, and is easier to extend than a thinner CRUD submission would be. The biggest weaknesses are around real-world insurance depth and operational rigor, but those are understandable scope cuts for the assignment and leave clear next steps for a follow-up pairing round.
