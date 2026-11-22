import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowNodeRow } from '../types';
import { evaluateCondition } from './condition-evaluator';

function condition(kind: string, config: Record<string, unknown>): WorkflowNodeRow {
  return {
    id: 'c1',
    workflow_id: 'w1',
    node_type: 'condition',
    kind,
    config: JSON.stringify(config),
    position_x: 0,
    position_y: 0,
    sort_order: 0,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

void test('time_window accepts the current minute and rejects a window three hours away', async () => {
  const now = new Date();
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const inside = await evaluateCondition(condition('time_window', { start: current, end: current }));
  assert.equal(inside.ok, true);

  const away = new Date(now.getTime());
  away.setHours((now.getHours() + 3) % 24);
  const slot = `${pad(away.getHours())}:${pad(away.getMinutes())}`;
  const outside = await evaluateCondition(condition('time_window', { start: slot, end: slot }));
  assert.equal(outside.ok, false);
  assert.equal(outside.reason, 'Outside time window');
});

void test('time_window covers the whole day', async () => {
  const result = await evaluateCondition(condition('time_window', { start: '00:00', end: '23:59' }));
  assert.equal(result.ok, true);
});

void test('time_window interpolates start and end from variables', async () => {
  const now = new Date();
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const result = await evaluateCondition(condition('time_window', { start: '{{open}}', end: '{{close}}' }), {
    open: current,
    close: current,
  });
  assert.equal(result.ok, true);
});

void test('invalid condition JSON fails closed', async () => {
  const node = condition('time_window', {});
  node.config = 'not-json';
  const result = await evaluateCondition(node);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Invalid condition config');
});

void test('unknown condition kinds pass so custom nodes do not block a run', async () => {
  const result = await evaluateCondition(condition('custom_gate', {}));
  assert.equal(result.ok, true);
});
