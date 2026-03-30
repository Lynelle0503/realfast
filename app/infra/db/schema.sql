PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  benefit_period TEXT NOT NULL,
  deductible REAL NOT NULL,
  coinsurance_percent REAL NOT NULL,
  annual_out_of_pocket_max REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS service_rules (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  service_code TEXT NOT NULL,
  covered INTEGER NOT NULL,
  yearly_dollar_cap REAL,
  yearly_visit_cap INTEGER,
  FOREIGN KEY (policy_id) REFERENCES policies(id)
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  date_of_service TEXT,
  diagnosis_codes_json TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_line_item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (policy_id) REFERENCES policies(id)
);

CREATE TABLE IF NOT EXISTS claim_line_items (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  service_code TEXT NOT NULL,
  description TEXT NOT NULL,
  billed_amount REAL NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claims(id)
);

CREATE TABLE IF NOT EXISTS line_decisions (
  id TEXT PRIMARY KEY,
  claim_line_item_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT,
  reason_text TEXT,
  member_next_step TEXT,
  payer_amount REAL,
  member_responsibility REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claim_line_item_id) REFERENCES claim_line_items(id)
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  referenced_line_item_ids_json TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claim_id) REFERENCES claims(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS accumulator_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  service_code TEXT NOT NULL,
  benefit_period_start TEXT NOT NULL,
  benefit_period_end TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  delta REAL NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (policy_id) REFERENCES policies(id)
);
