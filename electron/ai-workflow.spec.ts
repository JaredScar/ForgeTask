import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLoopbackChatEndpoint,
  buildWorkflowParseMessages,
  chatCompletionsUrlFromBase,
  parseWorkflowFromModelText,
  taskforgeWorkflowCompletionUrl,
  type AiChatMsg,
} from './ai-workflow';

void test('chat URL helpers trim trailing slashes', () => {
  assert.equal(chatCompletionsUrlFromBase('http://127.0.0.1:11435/'), 'http://127.0.0.1:11435/v1/chat/completions');
  assert.equal(
    taskforgeWorkflowCompletionUrl('http://127.0.0.1:11435'),
    'http://127.0.0.1:11435/v1/taskforge/workflow-completion'
  );
});

void test('assertLoopbackChatEndpoint allows only loopback http(s)', () => {
  assert.doesNotThrow(() => assertLoopbackChatEndpoint('http://127.0.0.1:11435/v1/taskforge/workflow-completion'));
  assert.doesNotThrow(() => assertLoopbackChatEndpoint('http://localhost:11435/'));
  assert.doesNotThrow(() => assertLoopbackChatEndpoint('http://[::1]:11435/'));
  assert.throws(() => assertLoopbackChatEndpoint('http://example.com/v1'), /loopback/);
  assert.throws(() => assertLoopbackChatEndpoint('file:///tmp/x'), /http/);
  assert.throws(() => assertLoopbackChatEndpoint('not a url'), /Invalid/);
});

void test('buildWorkflowParseMessages keeps a system prompt, recent history, and the new prompt', () => {
  const history: AiChatMsg[] = Array.from({ length: 14 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
  }));
  history.push({ role: 'system', content: 'drop me' });
  const messages = buildWorkflowParseMessages('make a backup', history);
  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages.at(-1)?.content, 'make a backup');
  const chat = messages.slice(1, -1);
  // The newest 12 history rows include the trailing system message, which is dropped.
  assert.equal(chat.length, 11);
  assert.equal(chat[0]?.content, 'm3');
  assert.ok(chat.every((m) => m.role === 'user' || m.role === 'assistant'));
});

void test('parseWorkflowFromModelText accepts fenced JSON', () => {
  const parsed = parseWorkflowFromModelText('```json\n{"name":"Morning","nodes":[]}\n```');
  assert.equal(parsed['name'], 'Morning');
  assert.deepEqual(parsed['nodes'], []);
});
