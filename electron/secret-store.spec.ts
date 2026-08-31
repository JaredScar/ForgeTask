import test from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import {
  decryptSecret,
  encryptSecret,
  findApiKeyByToken,
  isEncryptedValue,
  migratePlaintextSecrets,
  readSecretSetting,
  setSecretCipher,
  writeSecretSetting,
  type SecretCipher,
} from './secret-store';

/**
 * Stand-in for Electron's `safeStorage`, which only works inside a running
 * Electron app. The XOR is not cryptography — it exists so the tests can prove
 * ciphertext is not the plaintext and that round-trips work. A random suffix
 * makes output non-deterministic, matching the real IV behaviour that rules out
 * `WHERE token = ?` lookups.
 */
const fakeCipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString(plaintext) {
    const salt = Math.floor(Math.random() * 200) + 1;
    const body = Buffer.from(plaintext, 'utf8').map((b) => b ^ salt);
    return Buffer.concat([Buffer.from([salt]), body]);
  },
  decryptString(encrypted) {
    const salt = encrypted[0] ?? 0;
    return Buffer.from(encrypted.subarray(1).map((b) => b ^ salt)).toString('utf8');
  },
};

const unavailableCipher: SecretCipher = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('unavailable');
  },
  decryptString: () => {
    throw new Error('unavailable');
  },
};

type SettingRow = { key: string; value: string };
type ApiKeyRow = { id: string; token: string; scopes: string };
type VariableRow = { id: string; value: string; is_secret: number };

/**
 * Minimal stand-in for the three tables this module touches.
 *
 * `better-sqlite3` is compiled against Electron's ABI and cannot be loaded by
 * plain Node, so the specs in this project stay off the real driver. Only the
 * statements `secret-store.ts` actually issues are recognised; anything else
 * throws so a new query cannot silently pass untested.
 */
function freshDb() {
  const settings: SettingRow[] = [];
  const apiKeys: ApiKeyRow[] = [];
  const variables: VariableRow[] = [];

  const prepare = (sql: string) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (/^SELECT value FROM settings WHERE key = \?$/.test(q)) {
      return { get: (key: string) => settings.find((s) => s.key === key) };
    }
    if (/^SELECT value FROM settings WHERE key = '([a-z_]+)'$/.test(q)) {
      const key = /'([a-z_]+)'/.exec(q)?.[1];
      return { get: () => settings.find((s) => s.key === key) };
    }
    if (/^INSERT OR REPLACE INTO settings \(key, value\) VALUES \(\?, \?\)$/.test(q)) {
      return {
        run: (key: string, value: string) => {
          const existing = settings.find((s) => s.key === key);
          if (existing) existing.value = value;
          else settings.push({ key, value });
        },
      };
    }
    if (/^INSERT INTO settings \(key, value\) VALUES \('([a-z_]+)', '?(.*?)'?\)$/.test(q)) {
      const m = /VALUES \('([a-z_]+)', '(.*)'\)$/.exec(q);
      return { run: () => settings.push({ key: m?.[1] ?? '', value: m?.[2] ?? '' }) };
    }
    if (/^UPDATE settings SET value = \? WHERE key = \?$/.test(q)) {
      return {
        run: (value: string, key: string) => {
          const existing = settings.find((s) => s.key === key);
          if (existing) existing.value = value;
        },
      };
    }

    if (/^SELECT id, token, scopes FROM api_keys$/.test(q)) {
      return { all: () => apiKeys.map((k) => ({ ...k })) };
    }
    if (/^SELECT id, token FROM api_keys$/.test(q)) {
      return { all: () => apiKeys.map((k) => ({ id: k.id, token: k.token })) };
    }
    if (/^SELECT token FROM api_keys WHERE id = '(\w+)'$/.test(q)) {
      const id = /id = '(\w+)'/.exec(q)?.[1];
      return { get: () => apiKeys.find((k) => k.id === id) };
    }
    if (/^UPDATE api_keys SET token = \? WHERE id = \?$/.test(q)) {
      return {
        run: (token: string, id: string) => {
          const row = apiKeys.find((k) => k.id === id);
          if (row) row.token = token;
        },
      };
    }
    if (/^INSERT INTO api_keys \(id, token, scopes\) VALUES \(/.test(q)) {
      const literals = /VALUES \('(\w+)', '(.*?)', '(.*?)'\)$/.exec(q);
      if (literals) {
        return { run: () => apiKeys.push({ id: literals[1]!, token: literals[2]!, scopes: literals[3]! }) };
      }
      const withParam = /VALUES \('(\w+)', \?, '(.*?)'\)$/.exec(q);
      return { run: (token: string) => apiKeys.push({ id: withParam?.[1] ?? '', token, scopes: withParam?.[2] ?? '' }) };
    }

    if (/^SELECT id, value FROM variables WHERE is_secret = 1$/.test(q)) {
      return { all: () => variables.filter((v) => v.is_secret === 1).map((v) => ({ id: v.id, value: v.value })) };
    }
    if (/^SELECT value FROM variables WHERE id = '(\w+)'$/.test(q)) {
      const id = /id = '(\w+)'/.exec(q)?.[1];
      return { get: () => variables.find((v) => v.id === id) };
    }
    if (/^UPDATE variables SET value = \? WHERE id = \?$/.test(q)) {
      return {
        run: (value: string, id: string) => {
          const row = variables.find((v) => v.id === id);
          if (row) row.value = value;
        },
      };
    }
    if (/^INSERT INTO variables \(id, value, is_secret\) VALUES \(/.test(q)) {
      const m = /VALUES \('(\w+)', '(.*?)', (\d)\)$/.exec(q);
      return { run: () => variables.push({ id: m?.[1] ?? '', value: m?.[2] ?? '', is_secret: Number(m?.[3] ?? 0) }) };
    }

    throw new Error(`fake db: unsupported statement: ${q}`);
  };

  return {
    prepare,
    transaction: (fn: () => void) => fn,
  } as unknown as Database.Database;
}

void test('a stored secret is not recoverable by reading the raw column', () => {
  setSecretCipher(fakeCipher);
  const db = freshDb();

  writeSecretSetting(db, 'openai_api_key', 'sk-live-super-secret');

  const raw = (db.prepare(`SELECT value FROM settings WHERE key = 'openai_api_key'`).get() as { value: string })
    .value;
  assert.ok(isEncryptedValue(raw));
  assert.ok(!raw.includes('sk-live-super-secret'));
  assert.equal(readSecretSetting(db, 'openai_api_key'), 'sk-live-super-secret');
});

void test('encrypting the same secret twice yields different ciphertext', () => {
  setSecretCipher(fakeCipher);
  const values = new Set(Array.from({ length: 25 }, () => encryptSecret('same-input')));
  assert.ok(values.size > 1, 'ciphertext should not be deterministic');
  for (const v of values) assert.equal(decryptSecret(v), 'same-input');
});

void test('plaintext written by an older version still reads back', () => {
  setSecretCipher(fakeCipher);
  const db = freshDb();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('api_key', 'tf_live_legacy')`).run();

  assert.equal(readSecretSetting(db, 'api_key'), 'tf_live_legacy');
});

void test('migration encrypts legacy rows across settings, api keys and secret variables', () => {
  setSecretCipher(fakeCipher);
  const db = freshDb();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('openai_api_key', 'sk-plain')`).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('ui_theme', 'dark')`).run();
  db.prepare(`INSERT INTO api_keys (id, token, scopes) VALUES ('k1', 'tf_live_plain', '["*"]')`).run();
  db.prepare(`INSERT INTO variables (id, value, is_secret) VALUES ('v1', 'hunter2', 1)`).run();
  db.prepare(`INSERT INTO variables (id, value, is_secret) VALUES ('v2', 'not-a-secret', 0)`).run();

  migratePlaintextSecrets(db);

  const value = (key: string) =>
    (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string }).value;
  assert.ok(isEncryptedValue(value('openai_api_key')));
  assert.equal(readSecretSetting(db, 'openai_api_key'), 'sk-plain');

  // Non-secret rows are left alone so ordinary settings stay readable/queryable.
  assert.equal(value('ui_theme'), 'dark');
  assert.equal(
    (db.prepare(`SELECT value FROM variables WHERE id = 'v2'`).get() as { value: string }).value,
    'not-a-secret'
  );

  const token = (db.prepare(`SELECT token FROM api_keys WHERE id = 'k1'`).get() as { token: string }).token;
  assert.ok(isEncryptedValue(token));
  const secretVar = (db.prepare(`SELECT value FROM variables WHERE id = 'v1'`).get() as { value: string }).value;
  assert.ok(isEncryptedValue(secretVar));
  assert.equal(decryptSecret(secretVar), 'hunter2');
});

void test('migration is idempotent and does not double-encrypt', () => {
  setSecretCipher(fakeCipher);
  const db = freshDb();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('api_key', 'tf_live_plain')`).run();

  migratePlaintextSecrets(db);
  const afterFirst = (db.prepare(`SELECT value FROM settings WHERE key = 'api_key'`).get() as { value: string })
    .value;
  migratePlaintextSecrets(db);
  const afterSecond = (db.prepare(`SELECT value FROM settings WHERE key = 'api_key'`).get() as { value: string })
    .value;

  assert.equal(afterFirst, afterSecond);
  assert.equal(readSecretSetting(db, 'api_key'), 'tf_live_plain');
});

void test('api key lookup matches on the decrypted token', () => {
  setSecretCipher(fakeCipher);
  const db = freshDb();
  db.prepare(`INSERT INTO api_keys (id, token, scopes) VALUES ('k1', ?, '["workflows:read"]')`).run(
    encryptSecret('tf_live_aaa')
  );
  // A legacy plaintext row must keep working alongside encrypted ones.
  db.prepare(`INSERT INTO api_keys (id, token, scopes) VALUES ('k2', 'tf_live_bbb', '["*"]')`).run();

  assert.deepEqual(findApiKeyByToken(db, 'tf_live_aaa'), { id: 'k1', scopes: '["workflows:read"]' });
  assert.deepEqual(findApiKeyByToken(db, 'tf_live_bbb'), { id: 'k2', scopes: '["*"]' });
  assert.equal(findApiKeyByToken(db, 'tf_live_wrong'), null);
  assert.equal(findApiKeyByToken(db, ''), null);
});

void test('secrets fall back to plaintext when the platform has no keystore', () => {
  setSecretCipher(unavailableCipher);
  const db = freshDb();

  // Losing the setting entirely would be worse than storing it unencrypted, so
  // the app degrades instead of failing.
  writeSecretSetting(db, 'api_key', 'tf_live_nokeystore');
  assert.equal(readSecretSetting(db, 'api_key'), 'tf_live_nokeystore');
});

void test('a secret encrypted for another OS user decrypts to empty, not garbage', () => {
  setSecretCipher(fakeCipher);
  const envelope = encryptSecret('sk-from-another-machine');

  setSecretCipher({
    isEncryptionAvailable: () => true,
    encryptString: () => Buffer.from(''),
    decryptString: () => {
      throw new Error('DPAPI: key not found for this user');
    },
  });

  assert.equal(decryptSecret(envelope), '');
});

void test('empty and missing values round-trip without an envelope', () => {
  setSecretCipher(fakeCipher);
  const db = freshDb();

  assert.equal(encryptSecret(''), '');
  assert.equal(decryptSecret(''), '');
  assert.equal(decryptSecret(null), '');
  assert.equal(readSecretSetting(db, 'never_set'), '');
});
