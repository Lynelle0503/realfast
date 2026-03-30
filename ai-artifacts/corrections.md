# AI Corrections

This file records concrete corrections made during AI-assisted development and review.

## Correction 1: UI Endpoint Coverage Was Incomplete

Initial review of the local UI showed that it exercised the main workflow endpoints but not the singleton `GET /policies/{policyId}` and `GET /disputes/{disputeId}` endpoints. The UI was updated so those endpoints are now fetched and their JSON payloads are rendered in collapsible sections.

## Correction 2: Submission Deliverables Were Incomplete

The repository had working code and several docs, but it was missing required top-level submission artifacts:

- `README.md`
- `docs/self-review.md`
- `ai-artifacts/`

These were added during the submission-prep pass.

## Correction 3: Folder Layout Did Not Match The Requested Deliverable

The application code originally lived under `src/`. The submission requirement asked for `app/`, so the codebase was moved to `app/` and scripts, tests, and TypeScript configuration were updated to match.

## Correction 4: Docs Needed To Match Implemented Behavior

The earlier domain and decisions documents were close to the assignment prompt but not fully explicit about current implementation constraints. The docs were revised to reflect the real v1 behavior, including:

- one claim per member per policy
- claim status derivation from line items
- accumulator posting rules
- disputes being capture-only in v1
- current gaps such as missing service dates and unenforced out-of-pocket max

## Correction 5: Reason Catalog Scope Exceeded Current Inputs

The codebase includes reason codes such as `MISSING_INFORMATION` and `POLICY_NOT_ACTIVE`, but the current claim model does not yet include the data needed to produce those outcomes during adjudication. This was called out explicitly in the updated docs and self-review.
