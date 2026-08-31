import { safeStorage } from 'electron';
import type Database from 'better-sqlite3';

/**
 * At-rest encryption for secrets held in the local SQLite database.
 *
 * Values are wrapped as `tfsec1:<base64>` where the payload is produced by
 * Electron's `safeStorage`, which is backed by the OS keystore (DPAPI on
 * Windows, Keychain on macOS, libsecret on Linux). The key material is scoped
 * to the logged-in OS user, so another local user — or anyone reading the
 * database file from a backup or stolen disk — cannot recover the plaintext.
 *
 * This does not defend against code already running as the same user: such code
 * can ask the OS to decrypt too. It removes the "grep the .db file for API
 * keys" class of exposure.
 */
const ENVELOPE_PREFIX = 'tfsec1:';

/** Settings rows treated as secrets. */
export const SECRET_SETTING_KEYS = new Set([
  'openai_api_key',
  'local_ai_gateway_token',
  'pro_entitlement_key',
  'api_key',
]);

let warnedUnavailable = false;

/**
 * The subset of `safeStorage` this module needs. Kept as an indirection so the
 * unit tests can exercise the encrypt/decrypt paths, which is otherwise
 * impossible: `safeStorage` only works inside a running Electron app.
 */
export type SecretCipher = {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

// `safeStorage` is undefined when this module is loaded outside Electron.
let cipher: SecretCipher | undefined = safeStorage as SecretCipher | undefined;

/** Test-only override. */
export function setSecretCipher(next: SecretCipher | undefined): void {
  cipher = next;
  warnedUnavailable = false;
}

/** The active cipher, or `undefined` when this platform has no usable keystore. */
function availableCipher(): SecretCipher | undefined {
  try {
    if (!cipher?.isEncryptionAvailable) return undefined;
    return cipher.isEncryptionAvailable() ? cipher : undefined;
  } catch {
    return undefined;
  }
}

function warnOnce(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(
    '[taskforge] OS keystore unavailable — secrets are stored unencrypted in the local database. ' +
      'On Linux this usually means no libsecret/keyring service is running.'
  );
}

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/**
 * Encrypts a secret for storage. Returns the value unchanged when the platform
 * has no keystore, so the app keeps working rather than losing the setting.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const active = availableCipher();
  if (!active) {
    warnOnce();
    return plaintext;
  }
  try {
    return `${ENVELOPE_PREFIX}${active.encryptString(plaintext).toString('base64')}`;
  } catch {
    warnOnce();
    return plaintext;
  }
}

/**
 * Decrypts a stored secret. Values without the envelope prefix are returned
 * as-is, which lets databases written by older versions keep working and be
 * migrated lazily.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!isEncryptedValue(stored)) return stored;
  const active = availableCipher();
  if (!active) {
    warnOnce();
    return '';
  }
  try {
    return active.decryptString(Buffer.from(stored.slice(ENVELOPE_PREFIX.length), 'base64'));
  } catch {
    // Wrong OS user, rotated keystore, or corrupt row — treat as unreadable
    // rather than crashing the caller.
    return '';
  }
}

/** Decrypts only if the value carries the envelope; plain values pass through. */
export function decryptOptional(stored: string | null | undefined): string {
  if (stored == null) return '';
  return isEncryptedValue(stored) ? decryptSecret(stored) : stored;
}

export function readSecretSetting(db: Database.Database, key: string): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return decryptSecret(row?.value);
}

export function writeSecretSetting(db: Database.Database, key: string, plaintext: string): void {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, encryptSecret(plaintext));
}

/**
 * One-time upgrade of databases written before secrets were encrypted.
 *
 * Runs on every start but only rewrites rows that are still plaintext, so it is
 * idempotent and cheap.
 */
export function migratePlaintextSecrets(db: Database.Database): void {
  if (!availableCipher()) {
    warnOnce();
    return;
  }

  const tx = db.transaction(() => {
    const settingsUpdate = db.prepare(`UPDATE settings SET value = ? WHERE key = ?`);
    for (const key of SECRET_SETTING_KEYS) {
      const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
      if (!row?.value || isEncryptedValue(row.value)) continue;
      settingsUpdate.run(encryptSecret(row.value), key);
    }

    const tokenUpdate = db.prepare(`UPDATE api_keys SET token = ? WHERE id = ?`);
    const apiKeys = db.prepare(`SELECT id, token FROM api_keys`).all() as { id: string; token: string }[];
    for (const k of apiKeys) {
      if (!k.token || isEncryptedValue(k.token)) continue;
      tokenUpdate.run(encryptSecret(k.token), k.id);
    }

    const varUpdate = db.prepare(`UPDATE variables SET value = ? WHERE id = ?`);
    const secretVars = db.prepare(`SELECT id, value FROM variables WHERE is_secret = 1`).all() as {
      id: string;
      value: string;
    }[];
    for (const v of secretVars) {
      if (!v.value || isEncryptedValue(v.value)) continue;
      varUpdate.run(encryptSecret(v.value), v.id);
    }
  });

  try {
    tx();
  } catch (e) {
    console.error('[taskforge] secret migration failed', e);
  }
}

/**
 * Resolves a bearer token to an api_keys row.
 *
 * Tokens are encrypted with a random IV, so the same plaintext yields different
 * ciphertext every time and a `WHERE token = ?` lookup is impossible. The row
 * count here is user-created and small, so decrypting candidates is fine.
 */
export function findApiKeyByToken(
  db: Database.Database,
  bearer: string
): { id: string; scopes: string } | null {
  if (!bearer) return null;
  const rows = db.prepare(`SELECT id, token, scopes FROM api_keys`).all() as {
    id: string;
    token: string;
    scopes: string;
  }[];
  for (const row of rows) {
    if (decryptSecret(row.token) === bearer) {
      return { id: row.id, scopes: row.scopes };
    }
  }
  return null;
}
