import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  LOCAL_DEV_OPENAI_API_KEY_PLACEHOLDER,
  LOCAL_DEV_REST_API_KEY_PLACEHOLDER,
  isLocalDevOpenAiPlaceholder,
  isLocalDevRestApiPlaceholder,
} from './dev-placeholders';

void test('local placeholders are never treated as real credentials', () => {
  assert.equal(isLocalDevOpenAiPlaceholder(LOCAL_DEV_OPENAI_API_KEY_PLACEHOLDER), true);
  assert.equal(isLocalDevOpenAiPlaceholder('sk-local-forgetask-dev-other'), true);
  assert.equal(isLocalDevOpenAiPlaceholder('sk-live-real'), false);
  assert.equal(isLocalDevOpenAiPlaceholder(null), false);

  assert.equal(isLocalDevRestApiPlaceholder(`  ${LOCAL_DEV_REST_API_KEY_PLACEHOLDER}  `), true);
  assert.equal(isLocalDevRestApiPlaceholder('tf_live_real_key'), false);
});

void test('renderer placeholder strings match the main process', () => {
  const renderer = readFileSync(path.join(__dirname, '../src/app/core/local-dev-keys.ts'), 'utf8');
  assert.match(renderer, new RegExp(LOCAL_DEV_OPENAI_API_KEY_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(renderer, new RegExp(LOCAL_DEV_REST_API_KEY_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
