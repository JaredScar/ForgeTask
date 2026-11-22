import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkflowNodeRow } from '../types';
import { executeActionNode } from '../engine/action-executor';
import { delayWaitMs, runDelayWait } from './delay-wait.action';
import { runDownloadFile, runWakeOnLan, runZipArchive } from './pro-actions';
import { runSendEmail } from './send-email.action';
import { runInputSimulation } from './input-simulation';

function action(kind: string, config: unknown): WorkflowNodeRow {
  return {
    id: 'a1',
    workflow_id: 'w1',
    node_type: 'action',
    kind,
    config: typeof config === 'string' ? config : JSON.stringify(config),
    position_x: 0,
    position_y: 0,
    sort_order: 0,
  };
}

void test('executeActionNode rejects invalid JSON and unknown kinds', async () => {
  const bad = await executeActionNode(action('show_notification', '{'));
  assert.equal(bad.status, 'failure');
  assert.equal(bad.error, 'Invalid JSON config');

  const unknown = await executeActionNode(action('not_a_real_action', {}));
  assert.equal(unknown.status, 'failure');
  assert.equal(unknown.error, 'Unknown action kind');
});

void test('executeActionNode interpolates config before validating a URL', async () => {
  const result = await executeActionNode(action('open_url', { url: '{{link}}', label: 'Open' }), { link: 'file:///C:/secret' });
  assert.equal(result.status, 'failure');
  assert.match(result.error ?? '', /http/);
});

void test('executeActionNode refuses file operations and writes that have no path', async () => {
  const copy = await executeActionNode(action('file_operation', { operation: 'copy', source: '', destination: 'x' }));
  assert.equal(copy.error, 'Missing source path');
  const write = await executeActionNode(action('write_text_file', { path: '', content: 'hi' }));
  assert.equal(write.error, 'Missing path');
  const kill = await executeActionNode(action('kill_process', {}));
  assert.match(kill.error ?? '', /processName or pid/);
});

void test('executeActionNode writes a text file and creates a directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-action-'));
  try {
    const file = path.join(dir, 'note.txt');
    const nested = path.join(dir, 'nested', 'leaf');
    const written = await executeActionNode(action('write_text_file', { path: file, content: 'hello', label: 'Write' }));
    assert.equal(written.status, 'success');
    assert.equal(fs.readFileSync(file, 'utf8'), 'hello');

    const appended = await executeActionNode(action('write_text_file', { path: file, content: '!', append: true }));
    assert.equal(appended.status, 'success');
    assert.equal(fs.readFileSync(file, 'utf8'), 'hello!');

    const made = await executeActionNode(action('file_operation', { operation: 'mkdir', source: nested }));
    assert.equal(made.status, 'success');
    assert.equal(fs.statSync(nested).isDirectory(), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('set_variable updates the named row and reports the assignment', async () => {
  const updates: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
          updates.push([sql, ...args]);
        },
      };
    },
  };
  const missing = await executeActionNode(action('set_variable', { variableName: '  ' }), {}, {}, db as never);
  assert.equal(missing.error, 'Missing variableName');

  const saved = await executeActionNode(
    action('set_variable', { variableName: 'RETRY', variableValue: '{{n}}' }),
    { n: '3' },
    {},
    db as never
  );
  assert.equal(saved.status, 'success');
  assert.equal(saved.output, 'RETRY = 3');
  assert.deepEqual(updates[0]?.slice(1), ['3', 'RETRY']);
});

void test('delayWaitMs honors milliseconds, seconds, and the clamp', async () => {
  assert.equal(delayWaitMs({ delayMs: 1 }), 100);
  assert.equal(delayWaitMs({ delayMs: 250 }), 250);
  assert.equal(delayWaitMs({ delayMs: 9_999_999 }), 3_600_000);
  assert.equal(delayWaitMs({ delaySeconds: 2 }), 2000);
  assert.equal(delayWaitMs({ delaySeconds: 0 }), 100);
  assert.equal(delayWaitMs({ delayMs: 400, delaySeconds: 9 }), 400);
  assert.equal(delayWaitMs({}), 1000);
  assert.equal(delayWaitMs({ delayMs: 'nope' }), 1000);

  const waited = await runDelayWait({ delayMs: 100 });
  assert.equal(waited.waited, 100);
});

void test('pro actions fail closed before touching the network or disk', async () => {
  assert.deepEqual(await runZipArchive({ outputPath: '', sources: 'a.txt' }), { ok: false, error: 'Missing outputPath' });
  const noSources = await runZipArchive({ outputPath: 'out.zip', sources: '  ' });
  assert.equal(noSources.ok, false);
  assert.match(noSources.error ?? '', /sources/);

  assert.equal((await runDownloadFile({ url: '', destinationPath: '' })).ok, false);
  const local = await runDownloadFile({ url: 'http://127.0.0.1/secret', destinationPath: 'out.bin' });
  assert.equal(local.ok, false);
  assert.match(local.error ?? '', /blocked|private|loopback|http/i);

  assert.equal((await runWakeOnLan({ macAddress: '' })).ok, false);
  const badMac = await runWakeOnLan({ macAddress: 'not-a-mac' });
  assert.match(badMac.error ?? '', /MAC/);

  assert.equal((await runSendEmail({ smtpHost: '', to: 'a@b.c' })).ok, false);
  assert.equal((await runSendEmail({ smtpHost: 'smtp.example.com', to: '' })).ok, false);
});

void test('keyboard simulation refuses an empty key sequence', async () => {
  const result = await runInputSimulation({ mode: 'keyboard', text: '   ' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /text/);
});
