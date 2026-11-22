import test from 'node:test';
import assert from 'node:assert/strict';
import { writeAuditLog } from './audit';

void test('writeAuditLog inserts a successful localhost audit row', () => {
  let captured: unknown[] = [];
  let sql = '';
  const db = {
    prepare(statement: string) {
      sql = statement;
      return {
        run(...args: unknown[]) {
          captured = args;
        },
      };
    },
  };
  writeAuditLog(db as never, 'workflow.run', 'wf-1', 'owner');
  assert.match(sql, /INSERT INTO audit_logs/);
  assert.equal(captured[1], 'owner');
  assert.equal(captured[2], 'workflow.run');
  assert.equal(captured[3], 'wf-1');
  assert.equal(typeof captured[0], 'string');
  assert.equal(typeof captured[4], 'string');
});
