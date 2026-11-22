import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { audioControlPlan, audioControlScript } from '../actions/audio-control.action';
import { darkModeScript } from '../actions/dark-mode.action';
import { notificationContent } from '../actions/notification.action';
import { runOpenApplication } from '../actions/open-app.action';
import { runOpenFileOrFolder } from '../actions/open-file.action';
import { runScript } from '../actions/run-script.action';
import { runHttpRequest } from '../actions/http-request.action';
import { runTcpPortCheck, runZipArchive } from '../actions/pro-actions';
import type { WorkflowNodeRow } from '../types';
import { executeActionNode, lockWorkstationPlan } from './action-executor';
import {
  POLL_TRIGGER_KINDS,
  POWER_EVENTS,
  appLaunchShouldFire,
  clampIntervalMinutes,
  clipboardShouldFire,
  cpuMemoryFireReason,
  deviceConnectedShouldFire,
  deviceTriggerShouldFire,
  displayShouldFire,
  idleShouldFire,
  memoryThresholdMet,
  missedCronShouldReplay,
  networkMatches,
  normalizePowerEvent,
  powerEventShouldFire,
  processExitShouldFire,
  processMatchesConfig,
  triggerBinding,
  windowFocusShouldFire,
} from './trigger-rules';
import { webhookAuthorization, webhookSecretFromHeaders } from '../webhook-auth';

const TRIGGER_KINDS = [
  'time_schedule',
  'system_startup',
  'interval_trigger',
  'power_event',
  'app_launch',
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
];

function action(kind: string, config: Record<string, unknown>): WorkflowNodeRow {
  return {
    id: kind,
    workflow_id: 'w1',
    node_type: 'action',
    kind,
    config: JSON.stringify(config),
    position_x: 0,
    position_y: 0,
    sort_order: 0,
  };
}

void test('every catalog trigger has a binding the engine knows how to arm', () => {
  const modes = new Map(TRIGGER_KINDS.map((kind) => [kind, triggerBinding(kind, { path: 'C:\\watch', event: 'resume', intervalMinutes: 5 }).mode]));
  assert.equal(modes.get('time_schedule'), 'cron');
  assert.equal(modes.get('system_startup'), 'startup');
  assert.equal(modes.get('interval_trigger'), 'interval');
  assert.equal(modes.get('power_event'), 'power');
  assert.equal(modes.get('network_change'), 'network');
  assert.equal(modes.get('file_change'), 'watch');
  assert.equal(modes.get('webhook_trigger'), 'webhook');
  for (const kind of POLL_TRIGGER_KINDS) {
    assert.equal(modes.get(kind), 'poll', kind);
  }
  assert.equal(triggerBinding('not_a_trigger').mode, 'ignore');
  assert.deepEqual(triggerBinding('file_change', { path: '  ' }), { mode: 'watch', path: '' });
});

void test('time, startup, interval, and missed-cron rules', () => {
  assert.equal(clampIntervalMinutes(undefined), 30);
  assert.equal(clampIntervalMinutes(0), 1);
  assert.equal(clampIntervalMinutes(90.9), 90);
  assert.equal(clampIntervalMinutes(10_000), 24 * 60);
  assert.equal(clampIntervalMinutes('nope'), 30);
  assert.equal(triggerBinding('interval_trigger', { intervalMinutes: 15 }).mode === 'interval' && (triggerBinding('interval_trigger', { intervalMinutes: 15 }) as { minutes: number }).minutes, 15);

  const scheduled = Date.parse('2026-11-22T12:00:00.000Z');
  assert.equal(missedCronShouldReplay(scheduled - 10_000, scheduled), true);
  assert.equal(missedCronShouldReplay(scheduled, scheduled), false);
  assert.equal(missedCronShouldReplay(scheduled - 100, scheduled), false);
});

void test('power events accept the catalog list and debounce repeats', () => {
  for (const event of POWER_EVENTS) {
    assert.equal(normalizePowerEvent(event), event);
  }
  assert.equal(normalizePowerEvent('explode'), null);
  assert.equal(normalizePowerEvent(undefined), 'resume');
  assert.equal(powerEventShouldFire(0, 3_000), true);
  assert.equal(powerEventShouldFire(1_000, 3_999), false);
});

void test('app launch and process exit fire only on the edge', () => {
  assert.equal(processMatchesConfig('notepad', 'Notepad.exe'), true);
  assert.equal(processMatchesConfig('note', 'notepad.exe'), true);
  assert.equal(processMatchesConfig('chrome', 'notepad.exe'), false);
  assert.equal(processMatchesConfig('  ', 'notepad.exe'), false);

  assert.equal(appLaunchShouldFire(false, true), true);
  assert.equal(appLaunchShouldFire(true, true), false);
  assert.equal(appLaunchShouldFire(false, false), false);
  assert.equal(processExitShouldFire(true, false), true);
  assert.equal(processExitShouldFire(false, false), false);
  assert.equal(processExitShouldFire(true, true), false);
});

void test('cpu, memory, and idle thresholds', () => {
  assert.equal(
    cpuMemoryFireReason({ cpu: 96, usedPct: 10, cpuThreshold: 90, memThreshold: 90, lastCpu: 80, lastMem: 10 }),
    'cpu'
  );
  assert.equal(
    cpuMemoryFireReason({ cpu: 10, usedPct: 96, cpuThreshold: 90, memThreshold: 90, lastCpu: 10, lastMem: 80 }),
    'memory'
  );
  assert.equal(
    cpuMemoryFireReason({ cpu: 96, usedPct: 96, cpuThreshold: 90, memThreshold: 90, lastCpu: 95, lastMem: 80 }),
    'memory'
  );
  assert.equal(
    cpuMemoryFireReason({ cpu: 91, usedPct: 91, cpuThreshold: 90, memThreshold: 90, lastCpu: 90, lastMem: 90 }),
    null
  );

  assert.equal(memoryThresholdMet(90, 85, 'above'), true);
  assert.equal(memoryThresholdMet(80, 85, 'above'), false);
  assert.equal(memoryThresholdMet(20, 30, 'below'), true);
  assert.equal(memoryThresholdMet(40, 30, 'below'), false);

  assert.equal(idleShouldFire(120, 60, 0, 120_000), true);
  assert.equal(idleShouldFire(30, 60, 0, 120_000), false);
  assert.equal(idleShouldFire(120, 60, 100_000, 120_000), false);
});

void test('device, display, clipboard, window, and network triggers', () => {
  assert.equal(deviceConnectedShouldFire(null, 2), false);
  assert.equal(deviceConnectedShouldFire(1, 2), true);
  assert.equal(deviceConnectedShouldFire(2, 2), false);
  assert.equal(deviceConnectedShouldFire(2, 1), false);

  assert.equal(
    deviceTriggerShouldFire({ deviceType: 'usb', event: 'connect', previousUsb: 1, previousAudio: 1, usb: 2, audio: 1 }),
    true
  );
  assert.equal(
    deviceTriggerShouldFire({ deviceType: 'usb', event: 'disconnect', previousUsb: 1, previousAudio: 1, usb: 2, audio: 1 }),
    false
  );
  assert.equal(
    deviceTriggerShouldFire({ deviceType: 'audio', event: 'disconnect', previousUsb: 1, previousAudio: 2, usb: 1, audio: 1 }),
    true
  );
  assert.equal(
    deviceTriggerShouldFire({ deviceType: 'any', event: 'connect', previousUsb: null, previousAudio: 1, usb: 3, audio: 2 }),
    true
  );

  assert.equal(displayShouldFire(null, 2), false);
  assert.equal(displayShouldFire(1, 2), true);
  assert.equal(displayShouldFire(2, 2), false);

  assert.equal(clipboardShouldFire(null, 'hello', ''), false);
  assert.equal(clipboardShouldFire('hello', 'hello', ''), false);
  assert.equal(clipboardShouldFire('hello', 'hello world', ''), true);
  assert.equal(clipboardShouldFire('a', 'copy me', 'copy'), true);
  assert.equal(clipboardShouldFire('a', 'nothing', 'copy'), false);

  assert.equal(windowFocusShouldFire(null, 'Inbox - Outlook', 'Outlook'), false);
  assert.equal(windowFocusShouldFire('Desktop', 'Inbox - Outlook', 'outlook'), true);
  assert.equal(windowFocusShouldFire('Inbox - Outlook', 'Inbox - Outlook', 'Outlook'), false);
  assert.equal(windowFocusShouldFire('Desktop', 'Desktop', ''), false);

  assert.equal(networkMatches(['Home', 'Cafe'], ''), true);
  assert.equal(networkMatches([], ''), false);
  assert.equal(networkMatches(['Home'], 'Home'), true);
  assert.equal(networkMatches(['Home'], 'Cafe'), false);
});

void test('webhook trigger checks the secret before the workflow runs', () => {
  assert.equal(webhookAuthorization([], '').ok, false);
  assert.deepEqual(webhookAuthorization([{}], ''), { ok: true });
  assert.deepEqual(webhookAuthorization([{ secret: 's3cret' }], 's3cret'), { ok: true });
  const denied = webhookAuthorization([{ secret: 's3cret' }], 'nope');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 401);
  assert.equal(webhookSecretFromHeaders({ authorization: 'Bearer s3cret' }), 's3cret');
  assert.equal(webhookSecretFromHeaders({ 'x-webhook-secret': 's3cret' }), 's3cret');
});

void test('notification, theme, audio, and lock actions follow their settings', () => {
  assert.deepEqual(notificationContent({}), { title: 'TaskForge', body: 'Workflow notification' });
  assert.equal(notificationContent({ title: 'Hi', body: 'There' }).title, 'Hi');

  assert.match(darkModeScript('enable'), /-Value 0/);
  assert.match(darkModeScript('disable'), /-Value 1/);
  assert.match(darkModeScript('dark'), /-Value 0/);
  assert.match(darkModeScript('toggle'), /-not \$c/);

  assert.equal(audioControlPlan({ action: 'mute' }), 'mute');
  assert.equal(audioControlPlan({ action: 'unmute' }), 'unmute');
  assert.equal(audioControlPlan({ action: 'set-volume', volume: 40 }), 'volume');
  assert.equal(audioControlPlan({}), 'noop');
  assert.match(audioControlScript({ action: 'mute' }), /173/);
  assert.match(audioControlScript({ action: 'unmute' }), /175/);
  assert.match(audioControlScript({ action: 'set-volume' }), /1..0/);

  const lock = lockWorkstationPlan('win32');
  assert.equal(lock.ok, true);
  if (lock.ok) {
    assert.equal(lock.file, 'rundll32.exe');
    assert.deepEqual(lock.args, ['user32.dll,LockWorkStation']);
  }
  assert.equal(lockWorkstationPlan('linux').ok, false);
});

void test('open application and open folder refuse an empty path without launching anything', async () => {
  await assert.rejects(() => runOpenApplication({ path: '   ' }), /executable/);
  await assert.doesNotReject(() => runOpenFileOrFolder({ path: '' }));
});

void test('script, http, port check, and zip actions complete a real local workflow', async () => {
  const script = await runScript({ shell: 'powershell', script: "Write-Output 'taskforge-ok'" });
  assert.equal(script.stderr, '');
  assert.match(script.stdout, /taskforge-ok/);
  const missing = await runScript({ path: '' });
  assert.match(missing.stderr, /missing or not found/);

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(req.method === 'POST' ? 'posted' : 'pong');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const httpResult = await executeActionNode(
      action('http_request', { url: `http://127.0.0.1:${port}/hook`, method: 'POST', body: 'hi', allowPrivateNetwork: true, label: 'HTTP' })
    );
    assert.equal(httpResult.status, 'success');
    assert.equal(httpResult.output, 'posted');

    const open = await executeActionNode(action('tcp_port_check', { host: '127.0.0.1', port, timeoutMs: 1000, expectOpen: true, label: 'Port' }));
    assert.equal(open.status, 'success');
    assert.equal(open.output, 'open');

    const closed = await runTcpPortCheck({ host: '127.0.0.1', port: 1, timeoutMs: 300, expectOpen: false });
    assert.equal(closed.ok, true);
    assert.equal(closed.open, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-wf-'));
  try {
    const source = path.join(dir, 'note.txt');
    const zipPath = path.join(dir, 'out.zip');
    fs.writeFileSync(source, 'zip-me');
    const zipped = await runZipArchive({ outputPath: zipPath, sources: source });
    assert.equal(zipped.ok, true);
    assert.equal(fs.existsSync(zipPath), true);

    const copied = path.join(dir, 'copy.txt');
    const copy = await executeActionNode(action('file_operation', { operation: 'copy', source, destination: copied, label: 'Copy' }));
    assert.equal(copy.status, 'success');
    assert.equal(fs.readFileSync(copied, 'utf8'), 'zip-me');

    const moved = path.join(dir, 'moved.txt');
    const move = await executeActionNode(action('file_operation', { operation: 'move', source: copied, destination: moved, label: 'Move' }));
    assert.equal(move.status, 'success');
    assert.equal(fs.existsSync(copied), false);
    const deleted = await executeActionNode(action('file_operation', { operation: 'delete', source: moved, label: 'Delete' }));
    assert.equal(deleted.status, 'success');
    assert.equal(fs.existsSync(moved), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('unsafe actions fail closed instead of touching the machine', async () => {
  await assert.rejects(() => runHttpRequest({ url: 'http://127.0.0.1:9/', allowPrivateNetwork: false }), /blocked/i);

  const badPort = await runTcpPortCheck({ host: '127.0.0.1', port: 0, expectOpen: true });
  assert.equal(badPort.ok, false);

  const screenshot = await executeActionNode(action('screenshot_save', { path: '' }));
  assert.match(screenshot.error ?? '', /path/i);

  const input = await executeActionNode(action('input_simulation', { mode: 'keyboard', text: '' }));
  assert.equal(input.status, 'failure');
});
