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

export function initializeDatabase(options: SqliteDatabaseOptions = {}): Database.Database {
  const db = openDatabase(options);
  applySchema(db);
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
