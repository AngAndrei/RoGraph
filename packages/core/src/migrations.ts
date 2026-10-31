import type { DatabaseSync } from "node:sqlite";
export function migrateDatabase(
  db: DatabaseSync,
  schema: string,
  version: number,
): void {
  if (![0, 1, 2].includes(version))
    throw new Error("Unsupported storage version");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(schema.replace(/PRAGMA[^;]+;/g, ""));
    db.exec("PRAGMA user_version=2; COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
