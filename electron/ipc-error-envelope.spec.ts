import test from 'node:test';
import assert from 'node:assert/strict';
import { IPC_ERROR_FLAG, isIpcErrorEnvelope } from './ipc-error-envelope';

void test('isIpcErrorEnvelope accepts only the main-process error shape', () => {
  assert.equal(isIpcErrorEnvelope({ [IPC_ERROR_FLAG]: true, code: 'ENTITLEMENT_REQUIRED', message: 'ENTITLEMENT_REQUIRED' }), true);
  assert.equal(isIpcErrorEnvelope({ [IPC_ERROR_FLAG]: false, code: 'X', message: 'Y' }), false);
  assert.equal(isIpcErrorEnvelope({ code: 'ENTITLEMENT_REQUIRED' }), false);
  assert.equal(isIpcErrorEnvelope(null), false);
});
