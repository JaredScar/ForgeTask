import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearOnlineEntitlementCache,
  getLicenseApiUrl,
  getLicenseMode,
  getOrCreateDeviceId,
  isOnlineEntitlementSatisfied,
  refreshLicenseOnline,
  LICENSE_DEVICE_ID_KEY,
  LICENSE_LAST_VERIFIED_AT_KEY,
  LICENSE_OFFLINE_GRACE_SEC_KEY,
  LICENSE_VALID_UNTIL_KEY,
} from './license-remote';

function settingsDb(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  return {
    rows,
    writes,
    prepare(sql: string) {
      return {
        get(key?: string) {
          if (key == null) return undefined;
          const value = rows.get(key);
          return value === undefined ? undefined : { value };
        },
        run(...args: unknown[]) {
          writes.push({ sql, args });
          if (sql.includes('INSERT OR REPLACE') && args.length >= 2) {
            rows.set(String(args[0]), String(args[1]));
          }
          if (sql.includes('DELETE') && args.length >= 1) {
            rows.delete(String(args[0]));
          }
        },
      };
    },
  };
}

void test('getLicenseMode only accepts hybrid and online_strict', () => {
  const previous = process.env.TASKFORGE_LICENSE_MODE;
  try {
    delete process.env.TASKFORGE_LICENSE_MODE;
    assert.equal(getLicenseMode(), 'local');
    process.env.TASKFORGE_LICENSE_MODE = 'HYBRID';
    assert.equal(getLicenseMode(), 'hybrid');
    process.env.TASKFORGE_LICENSE_MODE = 'online_strict';
    assert.equal(getLicenseMode(), 'online_strict');
    process.env.TASKFORGE_LICENSE_MODE = 'anything-else';
    assert.equal(getLicenseMode(), 'local');
  } finally {
    if (previous === undefined) delete process.env.TASKFORGE_LICENSE_MODE;
    else process.env.TASKFORGE_LICENSE_MODE = previous;
  }
});

void test('getLicenseApiUrl ignores empty and non-https addresses', () => {
  const previous = process.env.TASKFORGE_LICENSE_API_URL;
  try {
    delete process.env.TASKFORGE_LICENSE_API_URL;
    assert.equal(getLicenseApiUrl(), undefined);
    process.env.TASKFORGE_LICENSE_API_URL = 'http://127.0.0.1:8080';
    assert.equal(getLicenseApiUrl(), undefined);
    process.env.TASKFORGE_LICENSE_API_URL = 'https://license.example.com/';
    assert.equal(getLicenseApiUrl(), 'https://license.example.com');
  } finally {
    if (previous === undefined) delete process.env.TASKFORGE_LICENSE_API_URL;
    else process.env.TASKFORGE_LICENSE_API_URL = previous;
  }
});

void test('isOnlineEntitlementSatisfied is true only before the cached instant', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isOnlineEntitlementSatisfied(settingsDb({ [LICENSE_VALID_UNTIL_KEY]: future }) as never), true);
  assert.equal(isOnlineEntitlementSatisfied(settingsDb({ [LICENSE_VALID_UNTIL_KEY]: past }) as never), false);
  assert.equal(isOnlineEntitlementSatisfied(settingsDb({ [LICENSE_VALID_UNTIL_KEY]: 'not-a-date' }) as never), false);
  assert.equal(isOnlineEntitlementSatisfied(settingsDb() as never), false);
});

void test('getOrCreateDeviceId reuses the stored id', () => {
  const db = settingsDb({ [LICENSE_DEVICE_ID_KEY]: 'device-1' });
  assert.equal(getOrCreateDeviceId(db as never), 'device-1');
  assert.equal(db.writes.length, 0);
});

void test('getOrCreateDeviceId stores a new id', () => {
  const db = settingsDb();
  const id = getOrCreateDeviceId(db as never);
  assert.match(id, /^[0-9a-f-]{36}$/i);
  assert.equal(db.rows.get(LICENSE_DEVICE_ID_KEY), id);
});

void test('clearOnlineEntitlementCache removes the online validation rows', () => {
  const db = settingsDb({
    [LICENSE_VALID_UNTIL_KEY]: 'x',
    [LICENSE_OFFLINE_GRACE_SEC_KEY]: '1',
    [LICENSE_LAST_VERIFIED_AT_KEY]: 'y',
    [LICENSE_DEVICE_ID_KEY]: 'keep',
  });
  clearOnlineEntitlementCache(db as never);
  assert.equal(db.rows.has(LICENSE_VALID_UNTIL_KEY), false);
  assert.equal(db.rows.has(LICENSE_OFFLINE_GRACE_SEC_KEY), false);
  assert.equal(db.rows.has(LICENSE_LAST_VERIFIED_AT_KEY), false);
  assert.equal(db.rows.get(LICENSE_DEVICE_ID_KEY), 'keep');
});

void test('refreshLicenseOnline succeeds without a network call when no https API is configured', async () => {
  const previous = process.env.TASKFORGE_LICENSE_API_URL;
  delete process.env.TASKFORGE_LICENSE_API_URL;
  try {
    const result = await refreshLicenseOnline(settingsDb() as never);
    assert.deepEqual(result, { ok: true });
  } finally {
    if (previous === undefined) delete process.env.TASKFORGE_LICENSE_API_URL;
    else process.env.TASKFORGE_LICENSE_API_URL = previous;
  }
});

void test('refreshLicenseOnline stores a fresh cache when the server accepts the key', async () => {
  const previous = process.env.TASKFORGE_LICENSE_API_URL;
  process.env.TASKFORGE_LICENSE_API_URL = 'https://license.example.com';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ valid: true, refresh_after_sec: 120 }), { status: 200 })) as typeof fetch;
  try {
    const db = settingsDb({ pro_entitlement_key: 'tfent1.payload.sig' });
    const result = await refreshLicenseOnline(db as never);
    assert.equal(result.ok, true);
    assert.equal(db.rows.get(LICENSE_OFFLINE_GRACE_SEC_KEY), '120');
    assert.ok(db.rows.get(LICENSE_VALID_UNTIL_KEY));
    assert.ok(db.rows.get(LICENSE_DEVICE_ID_KEY));
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.TASKFORGE_LICENSE_API_URL;
    else process.env.TASKFORGE_LICENSE_API_URL = previous;
  }
});

void test('refreshLicenseOnline clears the cache when the server rejects the key', async () => {
  const previous = process.env.TASKFORGE_LICENSE_API_URL;
  process.env.TASKFORGE_LICENSE_API_URL = 'https://license.example.com';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ valid: false }), { status: 401 })) as typeof fetch;
  try {
    const db = settingsDb({
      pro_entitlement_key: 'tfent1.payload.sig',
      [LICENSE_VALID_UNTIL_KEY]: 'stale',
    });
    const result = await refreshLicenseOnline(db as never);
    assert.deepEqual(result, { ok: false, error: 'invalid' });
    assert.equal(db.rows.has(LICENSE_VALID_UNTIL_KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.TASKFORGE_LICENSE_API_URL;
    else process.env.TASKFORGE_LICENSE_API_URL = previous;
  }
});
