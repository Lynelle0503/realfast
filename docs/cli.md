# CLI Guide

The Claims CLI runs directly against the application layer and SQLite persistence. It does not call the HTTP API.

## Run The CLI

```bash
npm run cli -- help
```

By default the CLI uses the local SQLite database at `tmp/claims.db`.

To point at a different database file:

```bash
npm run cli -- show member MEM-0001 --db /tmp/claims-demo.db
```

## Built-In Help

```bash
npm run cli -- help
```

That prints the supported workflow commands:

- `create member`
- `create policy <memberId>`
- `seed demo-data`
- `show member <memberId>`
- `show dispute <disputeId>`
- `show accumulator <policyId> <serviceCode>`
- `list policies <memberId>`
- `list claims <memberId>`
- `list disputes <claimId>`
- `submit claim`
- `adjudicate claim <claimId>`
- `resolve manual-review <claimId> <lineItemId> <approved|denied>`
- `pay claim <claimId>`
- `open dispute <claimId>`
- `resolve dispute <disputeId> <upheld|overturned>`
- `show claim <claimId>`

## Commands

### Create Member

```bash
npm run cli -- create member --full-name "Aarav Mehta" --date-of-birth 1988-07-14
```

### Create Policy

Create a policy for an existing member using flags:

```bash
npm run cli -- create policy MEM-0001 \
  --policy-type "Health PPO" \
  --effective-date 2026-01-01 \
  --benefit-period policy_year \
  --deductible 500 \
  --coinsurance-percent 80 \
  --annual-out-of-pocket-max 3000 \
  --service-rule "office_visit|true|1000|10" \
  --service-rule "lab_test|true|500|null" \
  --service-rule "prescription|false|null|null"
```

`--service-rule` is repeatable and must use:

```text
serviceCode|covered|yearlyDollarCap|yearlyVisitCap
```

Use `null` for no cap.

### Seed Demo Data

Recreates the database and inserts deterministic demo data.

```bash
npm run cli -- seed demo-data
```

With a custom database path:

```bash
npm run cli -- seed demo-data --db /tmp/claims-demo.db
```

### Show Member

```bash
npm run cli -- show member MEM-0001
```

### List Claims For Member

```bash
npm run cli -- list claims MEM-0001
```

### List Policies For Member

```bash
npm run cli -- list policies MEM-0001
```

The command now prints each policy’s service rules and caps, not just a summary.

### Submit Claim

You can submit a claim from a JSON file or from flags.

From JSON:

```bash
npm run cli -- submit claim --json ./claim.json
```

Expected JSON shape:

```json
{
  "memberId": "MEM-0001",
  "policyId": "POL-0001",
  "provider": {
    "providerId": "PRV-0501",
    "name": "CityCare Clinic"
  },
  "dateOfService": "2026-03-01",
  "diagnosisCodes": ["J02.9"],
  "lineItems": [
    {
      "serviceCode": "office_visit",
      "description": "Primary care consultation",
      "billedAmount": 150
    }
  ]
}
```

From flags:

```bash
npm run cli -- submit claim \
  --member-id MEM-0001 \
  --policy-id POL-0001 \
  --provider-id PRV-0501 \
  --provider-name "CityCare Clinic" \
  --date-of-service 2026-03-01 \
  --diagnosis-code J02.9 \
  --line-item "office_visit|Primary care consultation|150" \
  --line-item "lab_test|Rapid strep test|80"
```

`--line-item` is repeatable and must use:

```text
serviceCode|description|billedAmount
```

`--diagnosis-code` is repeatable.

### Adjudicate Claim

```bash
npm run cli -- adjudicate claim CLM-0001
```

The CLI also prints the accumulator effects posted by adjudication.

### Resolve Manual Review

```bash
npm run cli -- resolve manual-review CLM-0001 LI-0005 approved
```

Or deny the line:

```bash
npm run cli -- resolve manual-review CLM-0001 LI-0005 denied
```

### Pay Approved Line Items

Pay specific line items:

```bash
npm run cli -- pay claim CLM-0001 --line-item-id LI-0001 --line-item-id LI-0005
```

Or pay all currently approved line items:

```bash
npm run cli -- pay claim CLM-0001 --all-approved
```

### Open Dispute

```bash
npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --line-item-id LI-0004
```

Optional note:

```bash
npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --note "Please review the cap calculation." --line-item-id LI-0004
```

### List Disputes For Claim

```bash
npm run cli -- list disputes CLM-0001
```

### Show Dispute

```bash
npm run cli -- show dispute DSP-0001
```

### Resolve Dispute

```bash
npm run cli -- resolve dispute DSP-0001 overturned --note "Manual approval after review."
```

### Show Accumulator Usage

```bash
npm run cli -- show accumulator POL-0001 office_visit
```

This prints totals, underlying ledger entries, the matched service rule, and any remaining yearly dollar / visit benefit for the selected policy-service pair.

## Current Workflow Constraints

- New claim submission requires a claim-level `dateOfService`.
- Multiple claims on the same member-policy pair are now allowed.
- Dispute overturn is limited to disputes that reference denied line items.

### Show Claim

```bash
npm run cli -- show claim CLM-0001
```

The claim output is formatted for explainability and includes:

- claim status
- claim status explanation based on rollup rules
- dispute context for the claim, including open and resolved dispute statuses
- `approvedLineItemCount`
- each line item status
- payer amount
- member responsibility
- member-facing reason text
- next-step guidance when present
- matched service-rule coverage and cap details when available
- remaining benefit context when the decision depends on policy caps
- manual-review detail when a near-exhausted limit forced human review

## Typical Demo Flow

```bash
npm run cli -- seed demo-data
npm run cli -- show member MEM-0001
npm run cli -- list claims MEM-0001
npm run cli -- list policies MEM-0001
npm run cli -- show claim CLM-0001
npm run cli -- show accumulator POL-0001 office_visit
npm run cli -- show claim CLM-0002
npm run cli -- show claim CLM-0003
npm run cli -- resolve manual-review CLM-0001 LI-0005 approved
npm run cli -- pay claim CLM-0001 --all-approved
npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --line-item-id LI-0004
npm run cli -- resolve dispute DSP-0001 overturned --note "Manual approval after review."
npm run cli -- list disputes CLM-0001
```

Notes:

- `CLM-0002` is already adjudicated in the seeded data, so it should be inspected with `show claim`, not adjudicated again.
- `CLM-0003` is already paid in the seeded data and is useful for comparing final-state claim output.
- If you want to adjudicate a newly submitted claim through the CLI, create a fresh member and policy first, then submit a claim with `--date-of-service`.
