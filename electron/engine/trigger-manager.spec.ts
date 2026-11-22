import test from 'node:test';
import assert from 'node:assert/strict';
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
          if (sql.includes("kind = 'system_startup'")) return startup.map((workflow_id) => ({ workflow_id }));
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
