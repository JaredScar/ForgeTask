import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  DEV_ENTITLEMENT_BYPASS,
  FREE_WORKFLOW_LIMIT,
  WorkflowLimitError,
  assertFreeWorkflowLimit,
  assertProEnterprise,
  decodeEntitlementPayload,
  isProEnterpriseUnlocked,
  validateProEnterpriseKey,
  workflowNodesRequireProEntitlement,
} from './entitlement';

/** Builds a `tfent1.<payload>.<sig>` key signed with the given secret. */
function signKey(payloadObj: Record<string, unknown>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `tfent1.${payload}.${sig}`;
}

const DEV_SECRET = 'taskforge-desktop-dev-entitlement-v1';

void test('dev bypass string unlocks only unpackaged builds', () => {
  // These specs run outside Electron, so isPackagedBuild() reports false and the
  // bypass is expected to work. The packaged path is covered by the guard in
  // validateProEnterpriseKey, which returns isDevBypassAllowed().
  assert.equal(validateProEnterpriseKey(DEV_ENTITLEMENT_BYPASS), true);
});

void test('empty and malformed keys are rejected', () => {
  assert.equal(validateProEnterpriseKey(''), false);
  assert.equal(validateProEnterpriseKey('   '), false);
  assert.equal(validateProEnterpriseKey('not-a-key'), false);
  assert.equal(validateProEnterpriseKey('tfent1.only-two-parts'), false);
  assert.equal(validateProEnterpriseKey('badprefix.aaaa.bbbb'), false);
});

void test('a key signed with an unknown secret is rejected', () => {
  const forged = signKey({ seats: 5 }, 'some-other-secret-entirely');
  assert.equal(validateProEnterpriseKey(forged), false);
  assert.equal(decodeEntitlementPayload(forged), null);
});

void test('a validly signed key is accepted and its claims decoded', () => {
  const key = signKey({ seats: 5, exp: Math.floor(Date.now() / 1000) + 3600 }, DEV_SECRET);
  assert.equal(validateProEnterpriseKey(key), true);
  const decoded = decodeEntitlementPayload(key);
  assert.equal(decoded?.seats, 5);
});

void test('an expired key is rejected even though the signature is valid', () => {
  const key = signKey({ exp: Math.floor(Date.now() / 1000) - 60 }, DEV_SECRET);
  assert.notEqual(decodeEntitlementPayload(key), null, 'signature should still verify');
  assert.equal(validateProEnterpriseKey(key), false, 'expiry must be enforced');
});

void test('a tampered payload invalidates the signature', () => {
  const key = signKey({ seats: 1 }, DEV_SECRET);
  const [prefix, , sig] = key.split('.');
  const swappedPayload = Buffer.from(JSON.stringify({ seats: 999 })).toString('base64url');
  assert.equal(validateProEnterpriseKey(`${prefix}.${swappedPayload}.${sig}`), false);
});

function settingsDb(value: string | undefined, workflowCount: number) {
  return {
    prepare(sql: string) {
      return {
        get() {
          if (sql.includes('COUNT(*)')) return { count: workflowCount };
          if (value === undefined) return undefined;
          return { value };
        },
      };
    },
  };
}

void test('a free account can create workflows until the cap', () => {
  assert.doesNotThrow(() => assertFreeWorkflowLimit(settingsDb(undefined, FREE_WORKFLOW_LIMIT - 1) as never));
  assert.throws(() => assertFreeWorkflowLimit(settingsDb(undefined, FREE_WORKFLOW_LIMIT) as never), WorkflowLimitError);
  assert.throws(() => assertProEnterprise(settingsDb(undefined, 0) as never), /ENTITLEMENT_REQUIRED/);
});

void test('the local dev bypass unlocks Pro and skips the free workflow cap', () => {
  const db = settingsDb(DEV_ENTITLEMENT_BYPASS, 99);
  assert.equal(isProEnterpriseUnlocked(db as never), true);
  assert.doesNotThrow(() => assertFreeWorkflowLimit(db as never));
});

void test('workflowNodesRequireProEntitlement detects pro triggers and actions only', () => {
  assert.equal(workflowNodesRequireProEntitlement([{ node_type: 'trigger', kind: 'time_schedule' }]), false);
  assert.equal(workflowNodesRequireProEntitlement([{ node_type: 'action', kind: 'show_notification' }]), false);
  assert.equal(workflowNodesRequireProEntitlement([{ node_type: 'trigger', kind: 'file_change' }]), true);
  assert.equal(workflowNodesRequireProEntitlement([{ node_type: 'action', kind: 'http_request' }]), true);
  assert.equal(workflowNodesRequireProEntitlement([{ node_type: 'condition', kind: 'http_request' }]), false);
});
