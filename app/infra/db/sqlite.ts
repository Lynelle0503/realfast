import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(process.cwd(), 'tmp', 'claims.db');
const SCHEMA_PATH = resolve(CURRENT_DIR, 'schema.sql');

export interface SqliteDatabaseOptions {
  filePath?: string;
}

export function openDatabase(options: SqliteDatabaseOptions = {}): Database.Database {
  const filePath = options.filePath ?? DEFAULT_DB_PATH;
  mkdirSync(dirname(filePath), { recursive: true });

  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  return db;
}

export function applySchema(db: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(db: Database.Database, tableName: string, columnName: string, definition: string): void {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function runAdditiveMigrations(db: Database.Database): void {
  addColumnIfMissing(db, 'claims', 'date_of_service', 'TEXT');
  addColumnIfMissing(db, 'claim_line_items', 'date_of_service', 'TEXT');
  addColumnIfMissing(db, 'disputes', 'resolved_at', 'TEXT');
  addColumnIfMissing(db, 'disputes', 'resolution_note', 'TEXT');
  db.exec(
    `UPDATE claim_line_items
     SET date_of_service = (
       SELECT claims.date_of_service
       FROM claims
       WHERE claims.id = claim_line_items.claim_id
     )
     WHERE date_of_service IS NULL`
  );
}

export function initializeDatabase(options: SqliteDatabaseOptions = {}): Database.Database {
  const db = openDatabase(options);
  applySchema(db);
  runAdditiveMigrations(db);
  return db;
}

export function recreateDatabase(options: SqliteDatabaseOptions = {}): Database.Database {
  const filePath = options.filePath ?? DEFAULT_DB_PATH;

  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }

  return initializeDatabase({ filePath });
}

export function closeDatabase(db: Database.Database): void {
  db.close();
}

export { DEFAULT_DB_PATH, SCHEMA_PATH };
