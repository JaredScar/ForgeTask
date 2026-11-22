import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeOldLogs } from './log-retention';

function settingsDb(values: Record<string, string | undefined>) {
  const deletes: Array<{ sql: string; days: unknown }> = [];
  const db = {
    deletes,
    prepare(sql: string) {
      return {
        get() {
          if (sql.includes("'log_retention_forever'")) {
            const value = values['log_retention_forever'];
            return value === undefined ? undefined : { value };
          }
          if (sql.includes("'log_retention_days'")) {
            const value = values['log_retention_days'];
            return value === undefined ? undefined : { value };
          }
          return undefined;
        },
        run(days: unknown) {
          deletes.push({ sql, days });
        },
      };
    },
  };
  return db;
}

void test('purgeOldLogs deletes execution logs older than the retention window by started_at', () => {
  const db = settingsDb({ log_retention_forever: '0', log_retention_days: '14' });
  purgeOldLogs(db as never);
  assert.equal(db.deletes.length, 1);
  assert.match(db.deletes[0]!.sql, /started_at/);
  assert.doesNotMatch(db.deletes[0]!.sql, /created_at/);
  assert.equal(db.deletes[0]!.days, 14);
});

void test('purgeOldLogs keeps every row when retention is forever', () => {
  for (const flag of ['1', 'true']) {
    const db = settingsDb({ log_retention_forever: flag, log_retention_days: '7' });
    purgeOldLogs(db as never);
    assert.equal(db.deletes.length, 0, flag);
  }
});

void test('purgeOldLogs uses a 30 day default when the setting is missing', () => {
  const db = settingsDb({});
  purgeOldLogs(db as never);
  assert.equal(db.deletes.length, 1);
  assert.equal(db.deletes[0]!.days, 30);
});

void test('purgeOldLogs ignores a zero or non-numeric day count', () => {
  for (const days of ['0', '-3', 'nope']) {
    const db = settingsDb({ log_retention_days: days });
    purgeOldLogs(db as never);
    assert.equal(db.deletes.length, 0, days);
  }
});

void test('purgeOldLogs swallows database errors so startup can continue', () => {
  const db = {
    prepare() {
      throw new Error('sqlite down');
    },
  };
  assert.doesNotThrow(() => purgeOldLogs(db as never));
});
