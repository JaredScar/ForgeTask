import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowNodeRow } from '../types';
import { evaluateCondition, processNameMatches, wifiNetworkMatches } from './condition-evaluator';

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

void test('wifi_network matches an SSID and treats a blank SSID as any network', async () => {
  assert.equal(wifiNetworkMatches(['Home'], 'Home'), true);
  assert.equal(wifiNetworkMatches(['Home'], 'Office'), false);
  assert.equal(wifiNetworkMatches(['Home'], ''), true);
  assert.equal(wifiNetworkMatches([], ''), false);

  const home = await evaluateCondition(condition('wifi_network', { ssid: 'Home' }), {}, {}, {
    wifiNetworks: async () => [{ ssid: 'Home' }, { ssid: 'Cafe' }],
  });
  assert.equal(home.ok, true);

  const missing = await evaluateCondition(condition('wifi_network', { ssid: 'Office' }), {}, {}, {
    wifiNetworks: async () => [{ ssid: 'Home' }],
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason ?? '', /Office/);

  const any = await evaluateCondition(condition('wifi_network', { ssid: '' }), {}, {}, {
    wifiNetworks: async () => [],
  });
  assert.equal(any.ok, false);

  const lookupFailed = await evaluateCondition(condition('wifi_network', { ssid: 'Home' }), {}, {}, {
    wifiNetworks: async () => {
      throw new Error('adapter missing');
    },
  });
  assert.equal(lookupFailed.ok, true);
});

void test('app_running matches a process name substring', async () => {
  assert.equal(processNameMatches(['Code.exe', 'node.exe'], 'node'), true);
  assert.equal(processNameMatches(['Code.exe'], 'node'), false);
  assert.equal(processNameMatches([undefined], ''), false);

  const running = await evaluateCondition(condition('app_running', { process: 'Note' }), {}, {}, {
    processes: async () => ({ list: [{ name: 'notepad.exe' }, { name: 'explorer.exe' }] }),
  });
  assert.equal(running.ok, true);

  const stopped = await evaluateCondition(condition('app_running', { process: 'game' }), {}, {}, {
    processes: async () => ({ list: [{ name: 'notepad.exe' }] }),
  });
  assert.equal(stopped.ok, false);
  assert.match(stopped.reason ?? '', /game/);
});
