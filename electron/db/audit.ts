import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export function writeAuditLog(db: Database.Database, action: string, resource: string, userId = 'local'): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, resource, ip, status, created_at) VALUES (?, ?, ?, ?, 'localhost', 'Success', ?)`
  ).run(randomUUID(), userId, action, resource, now);
}
