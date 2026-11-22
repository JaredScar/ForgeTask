import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TriggerManager } from './trigger-manager';

type TriggerRow = { workflow_id: string; node_id: string; kind: string; config: string };

function harness(initial: TriggerRow[], startupIds: string[]) {
  let rows = initial;
  let startup = startupIds;
  const runs: Array<{ id: string; kind: string | undefined }> = [];
  const settings: Record<string, string> = { replay_missed_cron: '0' };
  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("kind = 'system_startup'") && sql.includes('DISTINCT')) {
            return startup.map((workflow_id) => ({ workflow_id }));
          }
          const specific = /kind = '([^']+)'/.exec(sql)?.[1];
          if (specific) {
            const matched = rows.filter((row) => row.kind === specific);
            if (sql.includes('DISTINCT')) return matched.map((row) => ({ workflow_id: row.workflow_id }));
            return matched;
          }
          if (sql.includes('n.kind')) return rows;
          throw new Error(`unexpected all: ${sql}`);
        },
        get(...args: unknown[]) {
          if (sql.includes('FROM settings')) return { value: settings[String(args[0])] ?? '0' };
          if (sql.includes('trigger_state')) return undefined;
          if (sql.includes('replay_missed')) return { replay_missed: 0 };
          throw new Error(`unexpected get: ${sql}`);
        },
        run() {
          /* trigger_state writes are optional */
        },
      };
    },
  };
  const engine = {
    async runWorkflow(id: string, kind?: string) {
      runs.push({ id, kind });
      return 'log';
    },
  };
  const manager = new TriggerManager(db as never, engine as never);
  return {
    manager,
    runs,
    settings,
    setRows(next: TriggerRow[]) {
      rows = next;
    },
    setStartup(ids: string[]) {
      startup = ids;
    },
    async disarm() {
      rows = [];
      startup = [];
      manager.reloadFromDatabase();
    },
  };
}

void test('startup triggers run only the enabled system_startup workflows', () => {
  const h = harness([], ['wf-on']);
  h.manager.runStartupTriggers();
  assert.deepEqual(h.runs, [{ id: 'wf-on', kind: 'system_startup' }]);
});

void test('reloading webhook, startup, and a blank file watch does not run them immediately', async () => {
  const h = harness(
    [
      { workflow_id: 'wf', node_id: 'n1', kind: 'webhook_trigger', config: JSON.stringify({ secret: 's3cret' }) },
      { workflow_id: 'wf', node_id: 'n2', kind: 'system_startup', config: '{}' },
      { workflow_id: 'wf', node_id: 'n3', kind: 'file_change', config: JSON.stringify({ path: '   ' }) },
      { workflow_id: 'wf', node_id: 'n4', kind: 'interval_trigger', config: JSON.stringify({ intervalMinutes: 30 }) },
    ],
    []
  );
  try {
    h.manager.reloadFromDatabase();
    assert.equal(h.manager.isEngineReady(), true);
    assert.deepEqual(h.runs, []);
  } finally {
    await h.disarm();
  }
});

void test('the poll loop fires each live trigger from supplied readings', async () => {
  const h = harness(
    [
      { workflow_id: 'wf-app', node_id: 'n-app', kind: 'app_launch', config: JSON.stringify({ process: 'notepad' }) },
      { workflow_id: 'wf-cpu', node_id: 'n-cpu', kind: 'cpu_memory_usage', config: JSON.stringify({ cpuPercent: 80, memPercent: 80 }) },
      { workflow_id: 'wf-idle', node_id: 'n-idle', kind: 'idle_trigger', config: JSON.stringify({ idleSeconds: 300 }) },
      { workflow_id: 'wf-mem', node_id: 'n-mem', kind: 'memory_trigger', config: JSON.stringify({ threshold: 85, comparison: 'above' }) },
      { workflow_id: 'wf-usb', node_id: 'n-usb', kind: 'device_trigger', config: JSON.stringify({ deviceType: 'usb', event: 'connect' }) },
      { workflow_id: 'wf-audio', node_id: 'n-audio', kind: 'device_connected', config: JSON.stringify({ device: 'audio' }) },
      { workflow_id: 'wf-exit', node_id: 'n-exit', kind: 'process_exit', config: JSON.stringify({ process: 'helper' }) },
      { workflow_id: 'wf-clip', node_id: 'n-clip', kind: 'clipboard_monitor', config: JSON.stringify({ filter: 'world' }) },
      { workflow_id: 'wf-focus', node_id: 'n-focus', kind: 'window_focus', config: JSON.stringify({ windowTitle: 'Code' }) },
      { workflow_id: 'wf-disp', node_id: 'n-disp', kind: 'display_change', config: '{}' },
    ],
    []
  );
  const quiet = {
    processRunning: () => false,
    cpu: 10,
    usedPct: 10,
    idleSec: 0,
    usb: 1,
    audio: 1,
    clipboard: 'hello',
    windowTitle: 'Desktop',
    displayCount: 1,
  };
  await h.manager.pollWithReadings(quiet);
  assert.equal(h.runs.length, 0);
  await h.manager.pollWithReadings({
    processRunning: (needle) => needle === 'notepad' || needle === 'helper',
    cpu: 96,
    usedPct: 96,
    idleSec: 400,
    usb: 2,
    audio: 2,
    clipboard: 'hello world',
    windowTitle: 'Visual Studio Code',
    displayCount: 2,
  });
  const fired = h.runs.map((run) => run.kind ?? '').sort();
  assert.deepEqual(fired, [
    'app_launch',
    'clipboard_monitor',
    'cpu_memory_usage',
    'device_connected',
    'device_trigger',
    'display_change',
    'idle_trigger',
    'memory_trigger',
    'window_focus',
  ]);
  await h.manager.pollWithReadings({
    ...quiet,
    processRunning: (needle) => needle === 'notepad',
    clipboard: 'hello world',
    windowTitle: 'Visual Studio Code',
    displayCount: 2,
    usb: 2,
    audio: 2,
    cpu: 96,
    usedPct: 96,
  });
  assert.deepEqual(h.runs.at(-1), { id: 'wf-exit', kind: 'process_exit' });
});

void test('a watched folder runs the workflow when a file appears', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-watch-'));
  const h = harness(
    [
      {
        workflow_id: 'wf-file',
        node_id: 'n-file',
        kind: 'file_change',
        config: JSON.stringify({ path: dir }),
      },
    ],
    []
  );
  try {
    h.manager.reloadFromDatabase();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(dir, 'note.txt'), 'hi');
    const deadline = Date.now() + 4000;
    while (h.runs.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(h.runs, [{ id: 'wf-file', kind: 'file_change' }]);
  } finally {
    await h.disarm();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('a power resume event runs the workflow once inside the debounce window', async () => {
  const h = harness(
    [
      {
        workflow_id: 'wf-power',
        node_id: 'n-power',
        kind: 'power_event',
        config: JSON.stringify({ event: 'resume' }),
      },
    ],
    []
  );
  try {
    h.manager.reloadFromDatabase();
    h.manager.emitPowerEvent('resume');
    h.manager.emitPowerEvent('resume');
    assert.deepEqual(h.runs, [{ id: 'wf-power', kind: 'power_event' }]);
  } finally {
    await h.disarm();
  }
});

void test('a network reading runs only when the SSID matches', async () => {
  const h = harness([], []);
  await h.manager.evaluateNetwork('wf-net', 'Home', ['Home']);
  await h.manager.evaluateNetwork('wf-net', 'Office', ['Home']);
  assert.deepEqual(h.runs, [{ id: 'wf-net', kind: 'network_change' }]);
});

void test('a missed cron is replayed when the setting is on, then the schedule is cleared', async () => {
  const h = harness(
    [
      {
        workflow_id: 'wf-cron',
        node_id: 'n-cron',
        kind: 'time_schedule',
        config: JSON.stringify({ cron: '0 0 1 1 *' }),
      },
    ],
    []
  );
  h.settings['replay_missed_cron'] = '1';
  try {
    h.manager.reloadFromDatabase();
    assert.deepEqual(h.runs, [{ id: 'wf-cron', kind: 'time_schedule' }]);
  } finally {
    await h.disarm();
  }
});
