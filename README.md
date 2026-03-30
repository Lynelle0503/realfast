# Claims Processing System

This repository contains a working v1 claims processing system for an insurance reimbursement workflow. It models members, policies, claims, claim line items, adjudication decisions, coverage accumulators, and disputes. The system can be exercised through a local web UI, a REST API, and a CLI.

## What The System Does

- Create members and member-owned policies.
- Submit claims with one or more line items.
- Adjudicate line items against policy `serviceRules` matched by `serviceCode`.
- Apply policy-level deductible and coinsurance.
- Enforce yearly dollar caps and yearly visit caps.
- Route partial-payment cases to `manual_review` instead of auto-approving them.
- Roll up line-item states into derived claim states.
- Mark approved line items as paid.
- Open disputes tied to claims and, optionally, specific denied line items.
- Track approved usage through accumulator ledger entries.

## Tech Stack

- TypeScript
- Node.js
- SQLite via `better-sqlite3`
- Minimal HTTP server from `node:http`
- Plain HTML/CSS/JS local UI
- Vitest for unit and integration tests

## Project Layout

- [app/](/Users/lynelle/Documents/CodeSpace/RealFast/app)
  Application code, domain model, infrastructure, UI, CLI, and API.
- [docs/domain-model.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/domain-model.md)
  Entities, relationships, and workflow state machines.
- [docs/decisions.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/decisions.md)
  Scope, assumptions, trade-offs, and known gaps.
- [docs/self-review.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/self-review.md)
  Honest assessment of strengths and weaknesses.
- [docs/api-layer.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/api-layer.md)
  Human-readable API overview.
- [api/openapi.yaml](/Users/lynelle/Documents/CodeSpace/RealFast/api/openapi.yaml)
  Machine-readable REST contract.
- [ai-artifacts/](/Users/lynelle/Documents/CodeSpace/RealFast/ai-artifacts)
  Prompt notes, reconstructed collaboration artifacts, and AI corrections.

## Prerequisites

- Node.js 20+ recommended
- npm

## Install

```bash
npm install
```

## Run The Local UI And API

Seed demo data:

```bash
npm run seed
```

Start the local server:

```bash
npm run start:ui
```

Then open:

- UI: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- API base: [http://127.0.0.1:3000/api/v1](http://127.0.0.1:3000/api/v1)

Notes:

- `start:ui` and `start:api` currently start the same local app server.
- By default the app uses `tmp/claims.db`.
- Override the database path with `CLAIMS_DB_PATH=/absolute/path/to/file.db npm run start:ui`.

## Run The CLI

Show help:

```bash
npm run cli -- help
```

Useful commands:

```bash
npm run cli -- seed demo-data
npm run cli -- list claims MEM-0001
npm run cli -- show claim CLM-0001
npm run cli -- adjudicate claim CLM-0001
npm run cli -- resolve manual-review CLM-0001 LI-0005 approved
npm run cli -- pay claim CLM-0001 --all-approved
npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --line-item-id LI-0004
```

## API Summary

Members and policies:

- `GET /api/v1/members`
- `POST /api/v1/members`
- `GET /api/v1/members/{memberId}`
- `GET /api/v1/members/{memberId}/policies`
- `POST /api/v1/members/{memberId}/policies`
- `GET /api/v1/policies/{policyId}`

Claims:

- `GET /api/v1/members/{memberId}/claims`
- `POST /api/v1/claims`
- `GET /api/v1/claims/{claimId}`
- `POST /api/v1/claims/{claimId}/adjudications`
- `POST /api/v1/claims/{claimId}/line-items/{lineItemId}/review-decisions`
- `POST /api/v1/claims/{claimId}/payments`

Disputes:

- `GET /api/v1/claims/{claimId}/disputes`
- `POST /api/v1/claims/{claimId}/disputes`
- `GET /api/v1/disputes/{disputeId}`

## Test And Validation

Run the automated checks:

```bash
npm test
npx tsc --noEmit -p tsconfig.json
```

At the time of this submission:

- Unit tests cover adjudication, explanations, claim rollup, benefit periods, and application commands.
- Integration tests cover SQLite persistence, CLI flows, API flows, seeding, and local UI serving.

## Submission Notes

This repository now matches the requested top-level deliverables:

- [app/](/Users/lynelle/Documents/CodeSpace/RealFast/app)
- [docs/domain-model.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/domain-model.md)
- [docs/decisions.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/decisions.md)
- [docs/self-review.md](/Users/lynelle/Documents/CodeSpace/RealFast/docs/self-review.md)
- [ai-artifacts/](/Users/lynelle/Documents/CodeSpace/RealFast/ai-artifacts)
- [README.md](/Users/lynelle/Documents/CodeSpace/RealFast/README.md)
- `.git/`

When packaging the submission, include the `.git` directory so commit history is preserved.
