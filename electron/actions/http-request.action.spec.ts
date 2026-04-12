import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isPrivateOrLoopbackIp } from './http-request.action';

void test('isPrivateOrLoopbackIp detects common private and loopback addresses', () => {
  assert.equal(isPrivateOrLoopbackIp('127.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackIp('10.1.2.3'), true);
  assert.equal(isPrivateOrLoopbackIp('192.168.1.8'), true);
  assert.equal(isPrivateOrLoopbackIp('8.8.8.8'), false);
});

void test('assertPublicHttpUrl rejects localhost URLs when private network is not allowed', async () => {
  await assert.rejects(() => assertPublicHttpUrl('http://localhost:3000', false), /blocked/i);
});

void test('assertPublicHttpUrl allows localhost URLs when private network is allowed', async () => {
  const parsed = await assertPublicHttpUrl('http://localhost:3000', true);
  assert.equal(parsed.hostname, 'localhost');
});
