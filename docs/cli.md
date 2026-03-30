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

- `seed demo-data`
- `show member <memberId>`
- `list policies <memberId>`
- `submit claim`
- `adjudicate claim <claimId>`
- `resolve manual-review <claimId> <lineItemId> <approved|denied>`
- `pay claim <claimId>`
- `open dispute <claimId>`
- `show claim <claimId>`

## Commands

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

### List Policies For Member

```bash
npm run cli -- list policies MEM-0001
```

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

### Show Claim

```bash
npm run cli -- show claim CLM-0001
```

The claim output is formatted for explainability and includes:

- claim status
- `approvedLineItemCount`
- each line item status
- payer amount
- member responsibility
- member-facing reason text
- next-step guidance when present

## Typical Demo Flow

```bash
npm run cli -- seed demo-data
npm run cli -- show member MEM-0001
npm run cli -- list policies MEM-0001
npm run cli -- show claim CLM-0001
npm run cli -- adjudicate claim CLM-0002
npm run cli -- resolve manual-review CLM-0001 LI-0005 approved
npm run cli -- pay claim CLM-0001 --all-approved
npm run cli -- open dispute CLM-0001 --reason "I disagree with the denial." --line-item-id LI-0004
```
