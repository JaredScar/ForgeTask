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

void test('isPrivateOrLoopbackIp covers link-local, CGNAT-adjacent and IPv6 ranges', () => {
  assert.equal(isPrivateOrLoopbackIp('169.254.169.254'), true, 'cloud metadata endpoint');
  assert.equal(isPrivateOrLoopbackIp('172.16.0.1'), true);
  assert.equal(isPrivateOrLoopbackIp('172.31.255.254'), true);
  assert.equal(isPrivateOrLoopbackIp('0.0.0.0'), true);
  assert.equal(isPrivateOrLoopbackIp('::1'), true);
  assert.equal(isPrivateOrLoopbackIp('fd00::1'), true);
  assert.equal(isPrivateOrLoopbackIp('fe80::1'), true);
  // Outside the private ranges.
  assert.equal(isPrivateOrLoopbackIp('172.32.0.1'), false);
  assert.equal(isPrivateOrLoopbackIp('1.1.1.1'), false);
});

void test('assertPublicHttpUrl rejects non-HTTP schemes', async () => {
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd', false), /HTTP/i);
  await assert.rejects(() => assertPublicHttpUrl('ftp://example.com', false), /HTTP/i);
  // Still rejected when private networking is permitted — the scheme is the problem.
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd', true), /HTTP/i);
});

void test('assertPublicHttpUrl blocks literal private and metadata addresses', async () => {
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1:38474/v1/workflows', false), /blocked/i);
  await assert.rejects(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/', false), /blocked/i);
  await assert.rejects(() => assertPublicHttpUrl('http://10.0.0.5/', false), /blocked/i);
  await assert.rejects(() => assertPublicHttpUrl('http://[::1]/', false), /blocked/i);
});

void test('assertPublicHttpUrl rejects malformed URLs', async () => {
  await assert.rejects(() => assertPublicHttpUrl('not a url', false), /Invalid URL/i);
});
