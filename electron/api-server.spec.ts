import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScopesJson, toErrorPayload } from './api-server';

void test('parseScopesJson filters invalid and duplicate scopes', () => {
  const scopes = parseScopesJson('["workflows:read","invalid","workflows:read","*"]');
  assert.deepEqual(scopes, ['workflows:read', '*']);
});

void test('parseScopesJson returns empty list on malformed JSON', () => {
  const scopes = parseScopesJson('{not-json');
  assert.deepEqual(scopes, []);
});

void test('toErrorPayload maps not-found errors to 404', () => {
  const payload = toErrorPayload(new Error('workflow not found: abc'));
  assert.equal(payload.status, 404);
  assert.equal(payload.error, 'workflow not found');
});

void test('toErrorPayload maps generic errors to 500', () => {
  const payload = toErrorPayload(new Error('unexpected failure'));
  assert.equal(payload.status, 500);
  assert.equal(payload.error, 'internal server error');
});
