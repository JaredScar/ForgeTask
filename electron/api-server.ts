import express from 'express';
import cors from 'cors';
import { app as electronApp } from 'electron';
import type Database from 'better-sqlite3';
import type { AutomationEngine } from './engine/automation-engine';
import type { TriggerManager } from './engine/trigger-manager';
import { randomUUID } from 'node:crypto';
import { isLocalDevRestApiPlaceholder } from './dev-placeholders';

type ApiRequest = express.Request & { tfScopes?: string[] };

const SCOPE_ALL = '*';
const SCOPE_WORKFLOWS_READ = 'workflows:read';
const SCOPE_WORKFLOWS_WRITE = 'workflows:write';
const SCOPE_WORKFLOWS_RUN = 'workflows:run';
const SCOPE_LOGS_READ = 'logs:read';
const SCOPE_VARIABLES_READ = 'variables:read';

function parseScopesJson(raw: string): string[] {
  try {
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function hasScope(scopes: string[], required: string): boolean {
  if (scopes.includes(SCOPE_ALL)) return true;
  return scopes.includes(required);
}

function resolveBearerAuth(db: Database.Database, bearer: string): string[] | null {
  const settingsKey = (db.prepare(`SELECT value FROM settings WHERE key = 'api_key'`).get() as { value: string } | undefined)?.value;
  if (settingsKey && bearer === settingsKey) {
    return [SCOPE_ALL];
  }
  const row = db.prepare(`SELECT scopes FROM api_keys WHERE token = ?`).get(bearer) as { scopes: string } | undefined;
  if (!row) return null;
  const scopes = parseScopesJson(row.scopes);
  return scopes.length ? scopes : [SCOPE_ALL];
}

export function startApiServer(
  db: Database.Database,
  engine: AutomationEngine,
  triggers: TriggerManager,
  port = 38474
): { stop: () => void } {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const auth = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const bearer = m?.[1]?.trim() ?? '';
    const r = req as ApiRequest;

    if (!electronApp.isPackaged && isLocalDevRestApiPlaceholder(bearer)) {
      r.tfScopes = [SCOPE_ALL];
      next();
      return;
    }

    const scopes = resolveBearerAuth(db, bearer);
    if (!scopes) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    r.tfScopes = scopes;
    next();
  });

  const need = (scope: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const r = req as ApiRequest;
    const scopes = r.tfScopes ?? [];
    if (!hasScope(scopes, scope)) {
      res.status(403).json({ error: 'Forbidden', required_scope: scope });
      return;
    }
    next();
  };

  app.post('/v1/workflows', need(SCOPE_WORKFLOWS_WRITE), (req, res) => {
    const body = req.body as { name?: string; description?: string };
    const name = String(body?.name ?? '').trim() || 'Untitled workflow';
    const description = String(body?.description ?? '');
    const id = randomUUID();
    const now = new Date().toISOString();
    const pr = (
      db.prepare(`SELECT value FROM settings WHERE key = 'default_workflow_priority'`).get() as { value: string } | undefined
    )?.value?.toLowerCase();
    const priority = pr === 'high' || pr === 'low' ? pr : 'normal';
    db.prepare(
      `INSERT INTO workflows (id, name, description, enabled, priority, tags, draft, run_count, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, '[]', 1, 0, ?, ?)`
    ).run(id, name, description, priority, now, now);
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, action, resource, ip, status, created_at) VALUES (?, ?, 'workflow.create', ?, ?, 'Success', ?)`
    ).run(randomUUID(), 'api', id, req.ip ?? 'localhost', now);
    triggers.reloadFromDatabase();
    res.status(201).json({ id, workflow_id: id });
  });

  app.get('/v1/workflows', need(SCOPE_WORKFLOWS_READ), (_req, res) => {
    const workflows = db
      .prepare(
        `SELECT id, name, description, enabled, priority, tags, draft, run_count, last_run_at, last_run_summary, created_at, updated_at FROM workflows ORDER BY updated_at DESC`
      )
      .all();
    res.json({ workflows });
  });

  app.get('/v1/workflows/:id', need(SCOPE_WORKFLOWS_READ), (req, res) => {
    const id = req.params['id'];
    const wf = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id);
    if (!wf) {
      res.status(404).json({ error: 'workflow not found' });
      return;
    }
    const nodes = db.prepare(`SELECT * FROM workflow_nodes WHERE workflow_id = ? ORDER BY sort_order`).all(id);
    const edges = db.prepare(`SELECT * FROM workflow_edges WHERE workflow_id = ?`).all(id);
    res.json({ workflow: wf, nodes, edges });
  });

  app.get('/v1/logs', need(SCOPE_LOGS_READ), (_req, res) => {
    const logs = db.prepare(`SELECT * FROM execution_logs ORDER BY started_at DESC LIMIT 200`).all();
    res.json({ logs });
  });

  app.get('/v1/logs/:id', need(SCOPE_LOGS_READ), (req, res) => {
    const id = req.params['id'];
    const log = db.prepare(`SELECT * FROM execution_logs WHERE id = ?`).get(id);
    if (!log) {
      res.status(404).json({ error: 'log not found' });
      return;
    }
    const steps = db.prepare(`SELECT * FROM log_steps WHERE log_id = ? ORDER BY rowid`).all(id);
    res.json({ log, steps });
  });

  app.get('/v1/variables', need(SCOPE_VARIABLES_READ), (_req, res) => {
    const rows = db
      .prepare(`SELECT id, name, type, value, scope FROM variables WHERE is_secret = 0 ORDER BY name`)
      .all();
    res.json({ variables: rows });
  });

  app.post('/v1/workflows/run', need(SCOPE_WORKFLOWS_RUN), async (req, res) => {
    const workflowId = (req.body as { workflow_id?: string })?.workflow_id;
    if (!workflowId) {
      res.status(400).json({ error: 'workflow_id required' });
      return;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, action, resource, ip, status, created_at) VALUES (?, ?, 'workflow.run', ?, ?, 'Success', ?)`
    ).run(id, 'api', workflowId, req.ip ?? 'localhost', now);
    await engine.runWorkflow(workflowId, 'api');
    triggers.reloadFromDatabase();
    res.json({ ok: true, workflow_id: workflowId });
  });

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`TaskForge API listening on http://127.0.0.1:${port}`);
  });

  return {
    stop: () => {
      server.close();
    },
  };
}
