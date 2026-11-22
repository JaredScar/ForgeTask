import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { LOCAL_DEV_REST_API_KEY_PLACEHOLDER } from './dev-placeholders';
import { encryptSecret } from './secret-store';
import { startApiServer } from './api-server';
import { openMemoryDatabase } from './testing/memory-db';

void test('the local HTTP API creates, lists, runs, and rejects workflows', async () => {
  const db = openMemoryDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workflows (id, name, description, enabled, priority, tags, draft, run_count, created_at, updated_at)
     VALUES ('wf-hook', 'Hooked', '', 1, 'normal', '[]', 0, 0, ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO workflow_nodes (id, workflow_id, node_type, kind, config, position_x, position_y, sort_order)
     VALUES ('n-hook', 'wf-hook', 'trigger', 'webhook_trigger', ?, 0, 0, 0)`
  ).run(JSON.stringify({ secret: 's3cret' }));
  db.prepare(
    `INSERT INTO variables (id, name, type, value, is_secret, scope, description) VALUES ('v1', 'REGION', 'string', 'east', 0, 'global', '')`
  ).run();
  db.prepare(
    `INSERT INTO api_keys (id, name, token, scopes, created_at, is_primary) VALUES ('k-logs', 'Logs', ?, '["logs:read"]', ?, 0)`
  ).run(encryptSecret('tf_live_logs_only_token'), now);

  const runs: string[] = [];
  const api = startApiServer(
    db,
    { async runWorkflow(id: string) { runs.push(id); return 'log-api'; }, getQueuedRunCount: () => 0 } as never,
    { reloadFromDatabase() {}, isEngineReady: () => true } as never,
    0
  );
  await new Promise<void>((resolve) => api.server.once('listening', () => resolve()));
  const port = (api.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${LOCAL_DEV_REST_API_KEY_PLACEHOLDER}` };

  try {
    const missing = await fetch(base + '/v1/workflows');
    assert.equal(missing.status, 401);

    const created = await fetch(base + '/v1/workflows', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'From API', description: 'remote' }),
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as { id: string };
    assert.ok(body.id);

    const listed = (await (await fetch(base + '/v1/workflows', { headers: auth })).json()) as {
      workflows: Array<{ name: string }>;
    };
    assert.ok(listed.workflows.some((row) => row.name === 'From API'));

    const one = await fetch(base + '/v1/workflows/' + body.id, { headers: auth });
    assert.equal(one.status, 200);

    const logsOnly = { authorization: 'Bearer tf_live_logs_only_token' };
    const forbidden = await fetch(base + '/v1/workflows', { headers: logsOnly });
    assert.equal(forbidden.status, 403);
    const logs = await fetch(base + '/v1/logs', { headers: logsOnly });
    assert.equal(logs.status, 200);

    const variables = (await (await fetch(base + '/v1/variables', { headers: auth })).json()) as {
      variables: Array<{ name: string; value: string }>;
    };
    assert.deepEqual(variables.variables, [{ id: 'v1', name: 'REGION', type: 'string', value: 'east', scope: 'global' }]);

    const ran = await fetch(base + '/v1/workflows/run', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ workflow_id: body.id }),
    });
    assert.equal(ran.status, 200);
    const ranBody = (await ran.json()) as { log_id: string };
    assert.equal(ranBody.log_id, 'log-api');
    assert.deepEqual(runs, [body.id]);

    const noSecret = await fetch(base + '/webhooks/wf-hook', { method: 'POST' });
    assert.equal(noSecret.status, 401);
    const hooked = await fetch(base + '/webhooks/wf-hook', {
      method: 'POST',
      headers: { 'x-webhook-secret': 's3cret' },
    });
    assert.equal(hooked.status, 200);
    assert.deepEqual(runs, [body.id, 'wf-hook']);
    const missingHook = await fetch(base + '/webhooks/missing', { method: 'POST' });
    assert.equal(missingHook.status, 404);
  } finally {
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
  }
});
