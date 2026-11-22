import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkflowNodeRow } from '../types';
import { AutomationEngine } from './automation-engine';

type Wf = { id: string; concurrency: 'allow' | 'queue' | 'skip'; run_count: number; last_run_summary: string | null };
type Log = {
  id: string;
  workflow_id: string;
  status: string;
  trigger_kind: string;
  message: string | null;
  error: string | null;
};
type Step = {
  log_id: string;
  step_type: string;
  step_kind: string;
  status: string;
  message: string;
  output: string | null;
};
type Edge = { workflow_id: string; source_node_id: string; target_node_id: string; branch: string | null };

function createDb(opts: { workflows: Wf[]; nodes: WorkflowNodeRow[]; edges?: Edge[]; variables?: { name: string; value: string }[] }) {
  const logs: Log[] = [];
  const steps: Step[] = [];
  const variables = opts.variables ?? [];
  const edges = opts.edges ?? [];
  const db = {
    logs,
    steps,
    variables,
    workflows: opts.workflows,
    prepare(sql: string) {
      return {
        get(...args: unknown[]) {
          if (sql.includes('SELECT concurrency')) {
            const wf = opts.workflows.find((w) => w.id === args[0]);
            return wf ? { concurrency: wf.concurrency } : undefined;
          }
          if (sql.includes('SELECT 1 FROM workflows')) {
            return opts.workflows.some((w) => w.id === args[0]) ? { ok: 1 } : undefined;
          }
          if (sql.includes('SELECT run_count')) {
            const wf = opts.workflows.find((w) => w.id === args[0]);
            return wf ? { run_count: wf.run_count } : undefined;
          }
          if (sql.includes('FROM settings')) return undefined;
          throw new Error(`unexpected get: ${sql}`);
        },
        all(...args: unknown[]) {
          if (sql.includes('FROM workflow_nodes')) return opts.nodes.filter((n) => n.workflow_id === args[0]);
          if (sql.includes('FROM variables')) return variables.map((v) => ({ ...v }));
          if (sql.includes('branch FROM workflow_edges')) {
            return edges.filter((e) => e.workflow_id === args[0]);
          }
          if (sql.includes('FROM workflow_edges')) {
            return edges
              .filter((e) => e.workflow_id === args[0])
              .map((e) => ({ source_node_id: e.source_node_id, target_node_id: e.target_node_id }));
          }
          throw new Error(`unexpected all: ${sql}`);
        },
        run(...args: unknown[]) {
          if (sql.includes('INSERT INTO execution_logs')) {
            if (sql.includes("'skipped'")) {
              logs.push({
                id: String(args[0]),
                workflow_id: String(args[1]),
                status: 'skipped',
                trigger_kind: String(args[4]),
                message: String(args[5]),
                error: null,
              });
            } else {
              logs.push({
                id: String(args[0]),
                workflow_id: String(args[1]),
                status: 'running',
                trigger_kind: String(args[3]),
                message: null,
                error: null,
              });
            }
            return;
          }
          if (sql.includes('UPDATE execution_logs')) {
            const failed = sql.includes("status = 'failure'");
            const id = String(failed ? args[3] : args[4]);
            const log = logs.find((row) => row.id === id);
            if (!log) throw new Error(`missing log ${id}`);
            log.status = failed ? 'failure' : String(args[1]);
            log.message = String(failed ? args[1] : args[2]);
            const err = failed ? args[2] : args[3];
            log.error = err == null ? null : String(err);
            return;
          }
          if (sql.includes('INSERT INTO log_steps')) {
            steps.push({
              log_id: String(args[1]),
              step_type: String(args[2]),
              step_kind: String(args[3]),
              status: String(args[4]),
              message: String(args[6]),
              output: args[8] == null ? null : String(args[8]),
            });
            return;
          }
          if (sql.includes('UPDATE workflows SET run_count')) {
            const wf = opts.workflows.find((w) => w.id === args[4]);
            if (!wf) throw new Error('missing workflow');
            wf.run_count = Number(args[0]);
            wf.last_run_summary = String(args[2]);
            return;
          }
          if (sql.includes('UPDATE workflows SET last_run_at')) {
            const wf = opts.workflows.find((w) => w.id === args[3]);
            if (wf) wf.last_run_summary = String(args[1]);
            return;
          }
          if (sql.includes('UPDATE variables')) {
            const row = variables.find((v) => v.name === args[1]);
            if (row) row.value = String(args[0]);
            return;
          }
          throw new Error(`unexpected run: ${sql}`);
        },
      };
    },
  };
  return db;
}

function node(
  partial: Pick<WorkflowNodeRow, 'id' | 'workflow_id' | 'node_type' | 'kind' | 'config' | 'sort_order'>
): WorkflowNodeRow {
  return { position_x: 0, position_y: 0, ...partial };
}

function awayMinute(): string {
  const now = new Date();
  const away = new Date(now.getTime());
  away.setHours((now.getHours() + 3) % 24);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(away.getHours())}:${pad(away.getMinutes())}`;
}

void test('a missing workflow is rejected before a log row is written', async () => {
  const db = createDb({ workflows: [], nodes: [] });
  const engine = new AutomationEngine(db as never);
  await assert.rejects(() => engine.runWorkflow('missing'), /workflow not found/);
  assert.equal(db.logs.length, 0);
});

void test('a manual run writes the log, records steps, and passes script output to the next action', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-engine-'));
  const outFile = path.join(dir, 'out.txt');
  const notes: string[] = [];
  const progress: string[] = [];
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'allow', run_count: 0, last_run_summary: null }],
    nodes: [
      node({ id: 't', workflow_id: 'wf', node_type: 'trigger', kind: 'system_startup', config: '{}', sort_order: 0 }),
      node({
        id: 's',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'run_script',
        config: JSON.stringify({ shell: 'powershell', script: "Write-Output 'taskforge-ok'", label: 'Script' }),
        sort_order: 1,
      }),
      node({
        id: 'w',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'write_text_file',
        config: JSON.stringify({ path: outFile, content: '{{context.stdout}}', label: 'Write' }),
        sort_order: 2,
      }),
    ],
  });
  const engine = new AutomationEngine(
    db as never,
    ({ logId }) => notes.push(logId),
    (step) => progress.push(step.stepKind)
  );
  try {
    const logId = await engine.runWorkflow('wf', 'manual');
    assert.equal(db.logs[0]?.status, 'success');
    assert.equal(db.logs[0]?.message, 'Workflow completed');
    assert.equal(db.logs[0]?.trigger_kind, 'manual');
    assert.equal(db.workflows[0]?.run_count, 1);
    assert.equal(db.workflows[0]?.last_run_summary, 'Completed successfully');
    assert.match(fs.readFileSync(outFile, 'utf8'), /^taskforge-ok\r?\n?$/);
    assert.deepEqual(
      db.steps.map((step) => step.step_kind),
      ['run_script', 'write_text_file']
    );
    assert.equal(notes.filter((id) => id === logId).length, 2);
    assert.deepEqual(progress, ['run_script', 'write_text_file']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('a non-manual run records the trigger step before the action', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-engine-'));
  const outFile = path.join(dir, 'note.txt');
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'allow', run_count: 4, last_run_summary: null }],
    nodes: [
      node({ id: 't', workflow_id: 'wf', node_type: 'trigger', kind: 'file_change', config: '{}', sort_order: 0 }),
      node({
        id: 'w',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'write_text_file',
        config: JSON.stringify({ path: outFile, content: 'fired' }),
        sort_order: 1,
      }),
    ],
  });
  const engine = new AutomationEngine(db as never);
  try {
    await engine.runWorkflow('wf', 'file_change');
    assert.equal(db.steps[0]?.message, 'Trigger fired');
    assert.equal(db.steps[0]?.step_kind, 'file_change');
    assert.equal(fs.readFileSync(outFile, 'utf8'), 'fired');
    assert.equal(db.workflows[0]?.run_count, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('a failed condition skips the rest of the workflow and says so in the log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-engine-'));
  const outFile = path.join(dir, 'should-not-exist.txt');
  const slot = awayMinute();
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'allow', run_count: 0, last_run_summary: null }],
    nodes: [
      node({
        id: 'c',
        workflow_id: 'wf',
        node_type: 'condition',
        kind: 'time_window',
        config: JSON.stringify({ start: slot, end: slot }),
        sort_order: 0,
      }),
      node({
        id: 'w',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'write_text_file',
        config: JSON.stringify({ path: outFile, content: 'nope' }),
        sort_order: 1,
      }),
    ],
  });
  const engine = new AutomationEngine(db as never);
  try {
    await engine.runWorkflow('wf', 'manual');
    assert.equal(db.logs[0]?.status, 'skipped');
    assert.equal(db.logs[0]?.message, 'Skipped by condition');
    assert.equal(db.steps.length, 1);
    assert.equal(db.steps[0]?.status, 'failure');
    assert.equal(fs.existsSync(outFile), false);
    assert.equal(db.workflows[0]?.last_run_summary, 'Skipped (condition)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('a branch follows the true path and leaves the false path unrun', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-engine-'));
  const yesFile = path.join(dir, 'yes.txt');
  const noFile = path.join(dir, 'no.txt');
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'allow', run_count: 0, last_run_summary: null }],
    variables: [{ name: 'FLAG', value: 'yes' }],
    nodes: [
      node({ id: 't', workflow_id: 'wf', node_type: 'trigger', kind: 'manual', config: '{}', sort_order: 0 }),
      node({
        id: 'b',
        workflow_id: 'wf',
        node_type: 'condition',
        kind: 'branch_if',
        config: JSON.stringify({ checkKind: 'variable_equals', variable: 'FLAG', value: 'yes' }),
        sort_order: 1,
      }),
      node({
        id: 'yes',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'write_text_file',
        config: JSON.stringify({ path: yesFile, content: 'yes' }),
        sort_order: 2,
      }),
      node({
        id: 'no',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'write_text_file',
        config: JSON.stringify({ path: noFile, content: 'no' }),
        sort_order: 3,
      }),
    ],
    edges: [
      { workflow_id: 'wf', source_node_id: 't', target_node_id: 'b', branch: null },
      { workflow_id: 'wf', source_node_id: 'b', target_node_id: 'yes', branch: 'true' },
      { workflow_id: 'wf', source_node_id: 'b', target_node_id: 'no', branch: 'false' },
    ],
  });
  const engine = new AutomationEngine(db as never);
  try {
    await engine.runWorkflow('wf', 'manual');
    assert.equal(fs.readFileSync(yesFile, 'utf8'), 'yes');
    assert.equal(fs.existsSync(noFile), false);
    assert.equal(db.logs[0]?.status, 'success');
    assert.ok(db.steps.some((step) => step.message === 'Branch: true path'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('set_variable updates the stored value during the run', async () => {
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'allow', run_count: 0, last_run_summary: null }],
    variables: [{ name: 'RETRY', value: '0' }],
    nodes: [
      node({
        id: 'v',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'set_variable',
        config: JSON.stringify({ variableName: 'RETRY', variableValue: '3' }),
        sort_order: 0,
      }),
    ],
  });
  const engine = new AutomationEngine(db as never);
  await engine.runWorkflow('wf', 'manual');
  assert.equal(db.variables[0]?.value, '3');
  assert.equal(db.steps[0]?.output, 'RETRY = 3');
  assert.equal(db.logs[0]?.status, 'success');
});

void test('a failing action stops the workflow and records the error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-engine-'));
  const missing = path.join(dir, 'missing.txt');
  const outFile = path.join(dir, 'later.txt');
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'allow', run_count: 0, last_run_summary: null }],
    nodes: [
      node({
        id: 'd',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'file_operation',
        config: JSON.stringify({ operation: 'delete', source: missing, retryCount: 1, retryDelayMs: 0 }),
        sort_order: 0,
      }),
      node({
        id: 'w',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'write_text_file',
        config: JSON.stringify({ path: outFile, content: 'later' }),
        sort_order: 1,
      }),
    ],
  });
  const engine = new AutomationEngine(db as never);
  try {
    await engine.runWorkflow('wf', 'manual');
    assert.equal(db.logs[0]?.status, 'failure');
    assert.equal(db.logs[0]?.message, 'Workflow failed');
    assert.match(db.logs[0]?.error ?? '', /ENOENT|no such file|cannot find/i);
    assert.ok(db.steps.some((step) => step.status === 'retrying'));
    assert.equal(fs.existsSync(outFile), false);
    assert.match(db.workflows[0]?.last_run_summary ?? '', /ENOENT|no such file|cannot find/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('skip concurrency writes a skipped log while a run is in progress', async () => {
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'skip', run_count: 0, last_run_summary: null }],
    nodes: [
      node({
        id: 'd',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'delay_wait',
        config: JSON.stringify({ delayMs: 150 }),
        sort_order: 0,
      }),
    ],
  });
  const engine = new AutomationEngine(db as never);
  const first = engine.runWorkflow('wf', 'manual');
  const secondId = await engine.runWorkflow('wf', 'interval_trigger');
  const firstId = await first;
  assert.notEqual(secondId, firstId);
  assert.equal(db.logs.find((log) => log.id === secondId)?.status, 'skipped');
  assert.match(db.logs.find((log) => log.id === secondId)?.message ?? '', /already running/);
  assert.equal(db.logs.find((log) => log.id === firstId)?.status, 'success');
});

void test('queue concurrency runs the waiting trigger after the current run finishes', async () => {
  const db = createDb({
    workflows: [{ id: 'wf', concurrency: 'queue', run_count: 0, last_run_summary: null }],
    nodes: [
      node({
        id: 'd',
        workflow_id: 'wf',
        node_type: 'action',
        kind: 'delay_wait',
        config: JSON.stringify({ delayMs: 120 }),
        sort_order: 0,
      }),
    ],
  });
  const engine = new AutomationEngine(db as never);
  const first = engine.runWorkflow('wf', 'manual');
  const queued = await engine.runWorkflow('wf', 'system_startup');
  assert.equal(queued, '');
  assert.equal(engine.getQueuedRunCount(), 1);
  await first;
  const started = Date.now();
  while (db.logs.filter((log) => log.status === 'success').length < 2) {
    if (Date.now() - started > 3000) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(db.logs.filter((log) => log.status === 'success').length, 2);
  assert.ok(db.logs.some((log) => log.trigger_kind === 'system_startup' && log.status === 'success'));
  assert.equal(engine.getQueuedRunCount(), 0);
});
