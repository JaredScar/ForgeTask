import { createHmac, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getLicenseApiUrl, getLicenseMode, isOnlineEntitlementSatisfied } from './license-remote';
import { LEGACY_DEV_ENTITLEMENT_SECRET } from './legacy-paths';
import { isPackagedBuild } from './runtime-mode';
import { readSecretSetting } from './secret-store';

/** Settings row key — Pro + Enterprise product entitlement (not the REST `api_key`). */
export const PRO_ENTITLEMENT_SETTINGS_KEY = 'pro_entitlement_key';

/**
 * Dev / CI unlock. Refused outright in packaged builds (see
 * `isDevBypassAllowed`), so a shipped installer can never be unlocked with a
 * string that is published in this repository.
 */
export const DEV_ENTITLEMENT_BYPASS = 'local-dev-pro-enterprise';

/** The dev bypass only applies to unpackaged (source-run) builds. */
function isDevBypassAllowed(): boolean {
  return !isPackagedBuild();
}

/** Current prefix; legacy prefix still accepted for older signed keys (see `legacy-paths.ts`). */
const KEY_PREFIXES = new Set(['tfent1', 'adent1']);

/** Maximum number of workflows allowed on the Free tier. */
export const FREE_WORKFLOW_LIMIT = 5;

export const PRO_TRIGGER_KINDS = new Set([
  'network_change',
  'file_change',
  'cpu_memory_usage',
  'device_connected',
  'idle_trigger',
  'memory_trigger',
  'device_trigger',
  'webhook_trigger',
  'process_exit',
  'window_focus',
  'display_change',
  'clipboard_monitor',
]);
export const PRO_ACTION_KINDS = new Set([
  'run_script',
  'http_request',
  'zip_archive',
  'download_file',
  'wake_on_lan',
  'tcp_port_check',
  'screenshot_save',
  'delay_wait',
  'send_email',
  'slack_notification',
  'set_variable',
  'input_simulation',
]);

/**
 * HMAC secrets accepted for offline key verification.
 *
 * The dev defaults are public (this repo is open source), so official builds
 * must set `TASKFORGE_ENTITLEMENT_SECRET` and additionally enforce entitlement
 * online via `TASKFORGE_LICENSE_API_URL` + `TASKFORGE_LICENSE_MODE=online_strict`.
 * See `assertEntitlementBuildConfig` for the release-time warning.
 */
function entitlementSecretCandidates(): readonly string[] {
  const e = process.env.TASKFORGE_ENTITLEMENT_SECRET?.trim();
  if (e) return [e];
  return ['taskforge-desktop-dev-entitlement-v1', LEGACY_DEV_ENTITLEMENT_SECRET];
}

/**
 * Warns at startup when a packaged build relies solely on the public dev HMAC
 * secret, which would let anyone forge a Pro key from published source.
 */
export function assertEntitlementBuildConfig(): void {
  if (!isPackagedBuild()) return;

  const hasPrivateSecret = Boolean(process.env.TASKFORGE_ENTITLEMENT_SECRET?.trim());
  const enforcedOnline = Boolean(getLicenseApiUrl()) && getLicenseMode() !== 'local';

  if (!hasPrivateSecret && !enforcedOnline) {
    console.warn(
      '[entitlement] This packaged build accepts keys signed with the PUBLIC dev secret. ' +
        'Set TASKFORGE_ENTITLEMENT_SECRET at build time and/or TASKFORGE_LICENSE_API_URL ' +
        'with TASKFORGE_LICENSE_MODE=online_strict before distributing.'
    );
  }
}

/**
 * Decodes a verified entitlement JWT-shaped key (`tfent1…` / legacy prefix). Returns null if format or HMAC is invalid.
 * Optional JSON claims: `exp` (unix sec), `seats` (positive int).
 */
export function decodeEntitlementPayload(raw: string): { seats?: number; exp?: number } | null {
  const key = raw.trim();
  if (!key || key === DEV_ENTITLEMENT_BYPASS) return null;
  const parts = key.split('.');
  if (parts.length !== 3 || !KEY_PREFIXES.has(parts[0]!)) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  try {
    const a = Buffer.from(sigB64, 'utf8');
    let signatureOk = false;
    for (const secret of entitlementSecretCandidates()) {
      const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url');
      const b = Buffer.from(expected, 'utf8');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        signatureOk = true;
        break;
      }
    }
    if (!signatureOk) return null;
    const payloadJson = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { exp?: number; seats?: number };
    const out: { seats?: number; exp?: number } = {};
    if (typeof payloadJson.exp === 'number') out.exp = payloadJson.exp;
    if (typeof payloadJson.seats === 'number' && payloadJson.seats > 0) out.seats = Math.floor(payloadJson.seats);
    return out;
  } catch {
    return null;
  }
}

/**
 * Validates `tfent1.<base64urlPayload>.<base64urlHmac>` (or the legacy three-part prefix) where HMAC-SHA256(secret, payload) matches.
 * Generate with: `node scripts/generate-entitlement-key.mjs`
 */
export function validateProEnterpriseKey(raw: string): boolean {
  const key = raw.trim();
  if (!key) return false;
  if (key === DEV_ENTITLEMENT_BYPASS) return isDevBypassAllowed();
  const decoded = decodeEntitlementPayload(raw);
  if (!decoded) return false;
  if (typeof decoded.exp === 'number' && decoded.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function readStoredEntitlementKey(db: Database.Database): string {
  return readSecretSetting(db, PRO_ENTITLEMENT_SETTINGS_KEY);
}

/**
 * Pro/Enterprise unlock: local key (HMAC / dev bypass, optional JWT `exp` in payload) plus,
 * when `TASKFORGE_LICENSE_API_URL` is set, cached online validation per §20.9 (`hybrid` / `online_strict`).
 */
export function isProEnterpriseUnlocked(db: Database.Database): boolean {
  const key = readStoredEntitlementKey(db).trim();
  if (!key) return false;

  const apiUrl = getLicenseApiUrl();
  const mode = getLicenseMode();

  if (mode === 'online_strict' && apiUrl) {
    return isOnlineEntitlementSatisfied(db);
  }

  if (!validateProEnterpriseKey(readStoredEntitlementKey(db))) return false;
  if (!apiUrl || mode === 'local') return true;
  return isOnlineEntitlementSatisfied(db);
}

export class EntitlementRequiredError extends Error {
  readonly code = 'ENTITLEMENT_REQUIRED' as const;
  constructor() {
    super('ENTITLEMENT_REQUIRED');
    this.name = 'EntitlementRequiredError';
  }
}

export class WorkflowLimitError extends Error {
  readonly code = 'WORKFLOW_LIMIT_REACHED' as const;
  constructor() {
    super(`WORKFLOW_LIMIT_REACHED:${FREE_WORKFLOW_LIMIT}`);
    this.name = 'WorkflowLimitError';
  }
}

export function assertProEnterprise(db: Database.Database): void {
  if (!isProEnterpriseUnlocked(db)) throw new EntitlementRequiredError();
}

/** Throws WorkflowLimitError when a free user tries to exceed the 5-workflow cap. */
export function assertFreeWorkflowLimit(db: Database.Database): void {
  if (isProEnterpriseUnlocked(db)) return;
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM workflows`).get() as { count: number };
  if (count >= FREE_WORKFLOW_LIMIT) throw new WorkflowLimitError();
}

/** True if any node uses a Pro trigger or Pro action kind. */
export function workflowNodesRequireProEntitlement(nodes: Array<Record<string, unknown>>): boolean {
  for (const n of nodes) {
    const nt = String(n['node_type'] ?? '');
    const kind = String(n['kind'] ?? '');
    if (nt === 'trigger' && PRO_TRIGGER_KINDS.has(kind)) return true;
    if (nt === 'action' && PRO_ACTION_KINDS.has(kind)) return true;
  }
  return false;
}
