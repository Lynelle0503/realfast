import { initializeDatabase, closeDatabase } from './sqlite.js';

function main(): void {
  const db = initializeDatabase();
  const tableCount = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { count: number };

  console.log(`Database initialized with ${tableCount.count} tables.`);
  console.log('Seed workflow scaffolded. Demo data will be added in a later phase.');
  closeDatabase(db);
}

main();
