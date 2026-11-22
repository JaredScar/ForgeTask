import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';

/** In-memory database with the desktop schema. better-sqlite3 is built for Electron, so tests use node:sqlite. */
export function openMemoryDatabase(): Database.Database {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  raw.exec(`ALTER TABLE workflows ADD COLUMN replay_missed INTEGER NOT NULL DEFAULT 0`);
  raw.exec(`ALTER TABLE api_keys ADD COLUMN last_used_at TEXT`);
  const db = raw as unknown as Database.Database;
  (db as unknown as { transaction: (fn: () => void) => () => void }).transaction = (fn: () => void) => {
    return () => {
      raw.exec('BEGIN');
      try {
        fn();
        raw.exec('COMMIT');
      } catch (err) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          /* the statement already aborted the transaction */
        }
        throw err;
      }
    };
  };
  return db;
}
