import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { DEV_ENTITLEMENT_BYPASS } from './entitlement';
import { invokeRegisteredIpc, IPC_ERROR_FLAG, registeredIpcChannels } from './ipc-handle';
import { registerIpcHandlers } from './ipc-handlers';
import { setNativeDialogOverridesForTests } from './native-dialogs';
import { openMemoryDatabase } from './testing/memory-db';

const TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><URI>\\Nightly\\Backup</URI></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2025-06-01T02:30:00</StartBoundary>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Actions><Exec><Command>C:\\Scripts\\backup.ps1</Command></Exec></Actions>
</Task>`;

void test('the main-process API saves workflows, settings, team, logs, licenses, and imports', async () => {
  delete process.env.TASKFORGE_LICENSE_API_URL;
  delete process.env.TASKFORGE_LICENSE_MODE;
  delete process.env.TASKFORGE_MARKETPLACE_URL;

  const db = openMemoryDatabase();
  const runs: string[] = [];
  const reloads: number[] = [];
  registerIpcHandlers(
    db,
    {
      async runWorkflow(id: string) {
        runs.push(id);
        return 'log-from-engine';
      },
      getQueuedRunCount: () => 2,
    } as never,
    {
      reloadFromDatabase() {
        reloads.push(1);
      },
      isEngineReady: () => true,
    } as never,
    () => null
  );

  const preload = fs.readFileSync(path.join(__dirname, 'preload.ts'), 'utf8');
  const channels = [...preload.matchAll(/inv(?:<[^>]+>)?\(\s*'([^']+)'/g)].map((match) => match[1]);
  const registered = new Set(registeredIpcChannels());
  for (const channel of channels) {
    assert.equal(registered.has(channel), true, channel);
  }

  const invoke = <T>(channel: string, ...args: unknown[]) => invokeRegisteredIpc<T>(channel, ...args);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-ipc-'));
  try {
    const locked = await invoke<{ unlocked: boolean }>('entitlement:getStatus');
    assert.equal(locked.unlocked, false);

    const invalid = await invoke<{ ok: boolean; error?: string }>('entitlement:setKey', 'not-a-real-key');
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error, 'invalid_key');

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await invoke<string>('workflows:create', { name: `Free ${i}` }));
    const blocked = await invoke<Record<string, unknown>>('workflows:create', { name: 'Sixth' });
    assert.equal(blocked[IPC_ERROR_FLAG], true);
    assert.equal(blocked['code'], 'WORKFLOW_LIMIT_REACHED');
    assert.equal(await invoke('workflows:delete', ids.pop()), true);
    const proBlocked = await invoke<Record<string, unknown>>('workflows:createFromStarter', {
      mode: 'trigger',
      kind: 'webhook_trigger',
      displayTitle: 'Webhook',
    });
    assert.equal(proBlocked['code'], 'ENTITLEMENT_REQUIRED');

    const unlocked = await invoke<{ ok: boolean; unlocked: boolean }>('entitlement:setKey', DEV_ENTITLEMENT_BYPASS);
    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.unlocked, true);
    for (const id of ids) assert.equal(await invoke('workflows:delete', id), true);

    const id = await invoke<string>('workflows:create', { name: 'Morning routine', description: 'Opens mail' });
    await invoke('workflows:update', {
      id,
      name: 'Morning routine',
      draft: false,
      concurrency: 'queue',
      nodes: [
        { id: 'n1', node_type: 'trigger', kind: 'system_startup', config: { label: 'On login' }, sort_order: 0 },
        { id: 'n2', node_type: 'action', kind: 'show_notification', config: { title: 'Hi', body: 'There' }, sort_order: 1 },
      ],
      edges: [{ id: 'e1', source_node_id: 'n1', target_node_id: 'n2' }],
    });
    const loaded = await invoke<{ workflow: { name: string; concurrency: string }; nodes: unknown[]; edges: unknown[] }>(
      'workflows:get',
      id
    );
    assert.equal(loaded.workflow.name, 'Morning routine');
    assert.equal(loaded.workflow.concurrency, 'queue');
    assert.equal(loaded.nodes.length, 2);
    assert.equal(loaded.edges.length, 1);

    const copyId = await invoke<string>('workflows:duplicate', id);
    const copy = await invoke<{ workflow: { name: string } }>('workflows:get', copyId);
    assert.equal(copy.workflow.name, 'Copy of Morning routine');
    assert.equal(await invoke('workflows:toggle', copyId), false);
    assert.equal(await invoke('workflows:setEnabled', { id: copyId, enabled: true }), true);
    assert.equal(await invoke('workflows:setReplayMissed', { id: copyId, replayMissed: true }), true);
    assert.equal(await invoke('workflows:appendNode', { workflowId: id, nodeType: 'action', kind: 'delay_wait' }), true);
    const usage = await invoke<Array<{ kind: string; count: number }>>('catalog:usageByKind', 'action');
    assert.ok(usage.some((row) => row.kind === 'show_notification' && row.count >= 1));

    const starter = await invoke<string>('workflows:createFromStarter', {
      mode: 'action',
      kind: 'write_text_file',
      displayTitle: 'Write text file',
    });
    assert.ok(starter);

    await invoke('settings:set', { key: 'ui_theme', value: 'light' });
    assert.equal(await invoke('settings:get', 'ui_theme'), 'light');
    const rejected = await invoke<Record<string, unknown>>('settings:set', { key: 'pro_entitlement_key', value: 'x' });
    assert.equal(rejected['code'], 'INTERNAL');
    assert.equal(await invoke('settings:resetPreferences'), true);
    assert.equal(await invoke('settings:get', 'log_retention_days'), '30');
    assert.equal(await invoke('settings:get', 'ui_theme'), 'dark');

    assert.equal(await invoke('variables:create', { name: 'TOKEN', type: 'string', value: 's3cret', is_secret: true }), true);
    const variables = await invoke<Array<{ id: string; name: string; value: string }>>('variables:list');
    const token = variables.find((row) => row.name === 'TOKEN');
    assert.equal(token?.value, 's3cret');
    assert.equal(await invoke('variables:update', { id: token!.id, value: 'rotated' }), true);
    assert.equal(await invoke('variables:delete', token!.id), true);

    const memberId = await invoke<string>('team:invite', { email: 'ada@example.com', display_name: 'Ada', role: 'Editor' });
    const team = await invoke<Array<{ id: string; email: string }>>('team:list');
    assert.ok(team.some((row) => row.email === 'ada@example.com'));
    assert.equal(await invoke('team:remove', memberId), true);

    db.prepare(
      `INSERT INTO execution_logs (id, workflow_id, started_at, finished_at, status, trigger_kind, message, error)
       VALUES ('log-1', ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:01.000Z', 'success', 'manual', 'done', NULL)`
    ).run(id);
    const logs = await invoke<Array<{ id: string }>>('logs:list', { workflowId: id });
    assert.equal(logs[0]?.id, 'log-1');
    const detail = await invoke<{ log: { status: string }; steps: unknown[] }>('logs:get', 'log-1');
    assert.equal(detail.log.status, 'success');

    setNativeDialogOverridesForTests({ save: async () => ({ canceled: true }) });
    assert.equal(await invoke('logs:export', 'csv'), null);
    const csvPath = path.join(dir, 'logs.csv');
    const jsonPath = path.join(dir, 'logs.json');
    setNativeDialogOverridesForTests({ save: async () => ({ canceled: false, filePath: csvPath }) });
    assert.equal(await invoke('logs:export', 'csv'), csvPath);
    assert.match(fs.readFileSync(csvPath, 'utf8'), /Morning routine/);
    setNativeDialogOverridesForTests({ save: async () => ({ canceled: false, filePath: jsonPath }) });
    assert.equal(await invoke('logs:export', 'json'), jsonPath);
    assert.equal(await invoke('logs:clear'), true);
    assert.equal((await invoke<unknown[]>('logs:list')).length, 0);

    const versions = await invoke<Array<{ id: string; version_number: number }>>('versions:list', id);
    assert.ok(versions.length >= 1);
    assert.equal(await invoke('versions:label', { id: versions[0]!.id, label: 'before rename' }), true);
    await invoke('workflows:update', { id, name: 'Renamed routine' });
    assert.equal(await invoke('versions:restore', { workflowId: id, versionId: versions[0]!.id }), true);
    const restored = await invoke<{ workflow: { name: string } }>('workflows:get', id);
    assert.equal(restored.workflow.name, 'Morning routine');
    assert.equal(await invoke('versions:delete', versions[0]!.id), true);

    const catalog = await invoke<Array<{ id: string }>>('marketplace:list');
    assert.ok(catalog.some((item) => item.id === 'tmpl_meeting'));
    const installed = await invoke<string>('marketplace:install', 'tmpl_meeting');
    const installedRow = await invoke<{ workflow: { source_template_id: string } }>('workflows:get', installed);
    assert.equal(installedRow.workflow.source_template_id, 'tmpl_meeting');

    const primary = await invoke<string>('api:regenerateKey');
    assert.match(primary, /^tf_live_/);
    assert.equal(await invoke('api:getKey'), primary);
    const created = await invoke<{ id: string; token: string }>('api:createKey', { name: 'CI', scopes: ['logs:read'] });
    const keys = await invoke<Array<{ id: string; is_primary: boolean }>>('api:listKeys');
    assert.equal(keys.length, 2);
    assert.equal(await invoke('api:revokeKey', keys.find((key) => key.is_primary)!.id), false);
    assert.equal(await invoke('api:revokeKey', created.id), true);

    const parsed = await invoke<{ nodes?: unknown; name?: string }>('ai:parse', 'When I log in, show a notification');
    assert.ok(parsed && (parsed.nodes || parsed.name));
    const streamed = await invoke<{ nodes?: unknown }>('ai:parseStream', { prompt: 'When I log in, show a notification' });
    assert.ok(streamed);

    assert.equal(await invoke('engine:runWorkflow', id), 'log-from-engine');
    assert.deepEqual(runs, [id]);
    assert.deepEqual(await invoke('engine:getStatus'), { running: true });
    const summary = await invoke<{ totalRuns: number }>('analytics:summary', { rangeDays: 7 });
    assert.equal(typeof summary.totalRuns, 'number');
    const stats = await invoke<{ queue: number; engineRunning: boolean }>('app:getStats');
    assert.equal(stats.engineRunning, true);
    assert.ok(stats.queue >= 2);
    assert.equal(typeof (await invoke<{ userData: string }>('app:getPaths')).userData, 'string');

    const audit = await invoke<Array<{ action: string }>>('audit:list', { action: 'workflow.create' });
    assert.ok(audit.length > 0);
    const auditPath = path.join(dir, 'audit.csv');
    setNativeDialogOverridesForTests({ save: async () => ({ canceled: false, filePath: auditPath }) });
    assert.equal(await invoke('audit:export'), auditPath);
    assert.match(fs.readFileSync(auditPath, 'utf8'), /workflow.create/);

    const zipPath = path.join(dir, 'export.zip');
    setNativeDialogOverridesForTests({ save: async () => ({ canceled: false, filePath: zipPath }) });
    assert.equal(await invoke('variables:create', { name: 'TOKEN', type: 'string', value: 's3cret', is_secret: true }), true);
    assert.equal(await invoke('data:exportZip'), zipPath);
    const packed = JSON.parse(new AdmZip(zipPath).getEntry('taskforge-data.json')!.getData().toString('utf8')) as {
      variables: Array<{ name: string; value: string }>;
    };
    assert.equal(packed.variables.find((row) => row.name === 'TOKEN')?.value, '');

    assert.equal(await invoke('workflows:delete', id), true);
    setNativeDialogOverridesForTests({ open: async () => ({ canceled: false, filePaths: [zipPath] }) });
    const imported = await invoke<{ ok: boolean; workflows: number }>('data:importZip');
    assert.equal(imported.ok, true);
    assert.ok(imported.workflows >= 1);
    const names = (await invoke<Array<{ name: string }>>('workflows:list')).map((row) => row.name);
    assert.ok(names.includes('Morning routine'));

    const xmlPath = path.join(dir, 'task.xml');
    fs.writeFileSync(xmlPath, TASK_XML);
    setNativeDialogOverridesForTests({ open: async () => ({ canceled: false, filePaths: [xmlPath] }) });
    const scheduled = await invoke<{ ok: boolean; imported: number }>('data:importTaskScheduler');
    assert.equal(scheduled.ok, true);
    assert.equal(scheduled.imported, 1);

    setNativeDialogOverridesForTests({ open: async () => ({ canceled: true, filePaths: [] }) });
    assert.equal(await invoke('dialog:pickExecutable'), null);
    const exePath = path.join(dir, 'tool.exe');
    fs.writeFileSync(exePath, '');
    setNativeDialogOverridesForTests({ open: async () => ({ canceled: false, filePaths: [exePath] }) });
    assert.equal(await invoke('dialog:pickExecutable'), exePath);

    assert.equal(await invoke('data:clearUserData'), true);
    assert.equal((await invoke<unknown[]>('workflows:list')).length, 0);
    assert.equal((await invoke<unknown[]>('variables:list')).length, 0);
    assert.ok(reloads.length > 0);
  } finally {
    setNativeDialogOverridesForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
