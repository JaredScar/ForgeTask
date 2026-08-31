import type Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { isProEnterpriseUnlocked, FREE_WORKFLOW_LIMIT } from './entitlement';
import { encryptSecret } from './secret-store';

/**
 * Settings an import file may set — an allowlist of user preferences only.
 *
 * This deliberately replaces the previous blocklist: a blocklist silently
 * admits every key nobody thought to add, which let an import file overwrite
 * the cached license-entitlement timestamps (`license_entitlement_valid_until`
 * and friends) and grant itself Pro. Anything not listed here is ignored.
 */
const SETTINGS_IMPORT_ALLOWLIST = new Set([
  'log_retention_days',
  'log_retention_forever',
  'clear_logs_on_startup',
  'engine_auto_start',
  'notify_desktop',
  'toast_position',
  'sound_on_workflow_failure',
  'replay_missed_cron',
  'default_workflow_priority',
  'ui_locale',
  'ui_theme',
  'ui_accent',
  'builder_show_json_default',
  'max_concurrent_workflows',
  'confirm_delete_workflow',
  'trigger_poll_interval_ms',
]);

/** Caps an imported settings value so a crafted file cannot bloat the DB. */
const MAX_SETTING_VALUE_LENGTH = 2000;

export type ImportZipResult =
  | { ok: true; workflows: number; variables: number; settingsApplied: number }
  | { ok: false; error: string };

function asRecordArray(v: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) throw new Error(`Invalid export: "${field}" must be an array`);
  return v as Record<string, unknown>[];
}

/**
 * Replaces all workflows (and related logs via FK cascade), variables, and merges non-secret settings from `taskforge-data.json` in the ZIP.
 */
export function importDataFromZipBuffer(db: Database.Database, buffer: Buffer): ImportZipResult {
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('taskforge-data.json');
    if (!entry) {
      return { ok: false, error: 'ZIP must contain taskforge-data.json (use TaskForge export).' };
    }
    const raw = entry.getData().toString('utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    let workflows = asRecordArray(data.workflows, 'workflows');
    const isPro = isProEnterpriseUnlocked(db);
    if (!isPro && workflows.length > FREE_WORKFLOW_LIMIT) {
      workflows = workflows.slice(0, FREE_WORKFLOW_LIMIT);
    }
    const allowedWorkflowIds = new Set(workflows.map((w) => String(w['id'])));
    const workflowNodes = asRecordArray(data.workflow_nodes, 'workflow_nodes').filter(
      (n) => allowedWorkflowIds.has(String(n['workflow_id']))
    );
    const workflowEdges = asRecordArray(data.workflow_edges, 'workflow_edges').filter(
      (e) => allowedWorkflowIds.has(String(e['workflow_id']))
    );
    const variables = asRecordArray(data.variables, 'variables');
    const settingsRows = Array.isArray(data.settings) ? (data.settings as { key?: string; value?: string }[]) : [];

    let settingsApplied = 0;
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM workflows`).run();
      db.prepare(`DELETE FROM variables`).run();

      const insW = db.prepare(
        `INSERT INTO workflows (id, name, description, enabled, priority, tags, draft, run_count, last_run_at, last_run_summary, created_at, updated_at, source_template_id, concurrency)
         VALUES (@id, @name, @description, @enabled, @priority, @tags, @draft, @run_count, @last_run_at, @last_run_summary, @created_at, @updated_at, @source_template_id, @concurrency)`
      );
      for (const w of workflows) {
        const conc = String(w['concurrency'] ?? 'allow');
        const concurrency = ['allow', 'queue', 'skip'].includes(conc) ? conc : 'allow';
        insW.run({
          id: String(w['id']),
          name: String(w['name'] ?? 'Imported'),
          description: String(w['description'] ?? ''),
          enabled: Number(w['enabled'] ?? 1) ? 1 : 0,
          priority: String(w['priority'] ?? 'normal'),
          tags: typeof w['tags'] === 'string' ? w['tags'] : JSON.stringify(w['tags'] ?? []),
          draft: Number(w['draft'] ?? 0) ? 1 : 0,
          run_count: Number(w['run_count'] ?? 0),
          last_run_at: w['last_run_at'] != null ? String(w['last_run_at']) : null,
          last_run_summary: w['last_run_summary'] != null ? String(w['last_run_summary']) : null,
          created_at: String(w['created_at'] ?? new Date().toISOString()),
          updated_at: String(w['updated_at'] ?? new Date().toISOString()),
          source_template_id: w['source_template_id'] != null ? String(w['source_template_id']) : null,
          concurrency,
        });
      }

      const insN = db.prepare(
        `INSERT INTO workflow_nodes (id, workflow_id, node_type, kind, config, position_x, position_y, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const n of workflowNodes) {
        const cfg = n['config'];
        const configStr = typeof cfg === 'string' ? cfg : JSON.stringify(cfg ?? {});
        insN.run(
          String(n['id']),
          String(n['workflow_id']),
          String(n['node_type']),
          String(n['kind']),
          configStr,
          Number(n['position_x'] ?? 0),
          Number(n['position_y'] ?? 0),
          Number(n['sort_order'] ?? 0)
        );
      }

      const insE = db.prepare(
        `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id) VALUES (?, ?, ?, ?)`
      );
      for (const e of workflowEdges) {
        insE.run(
          String(e['id']),
          String(e['workflow_id']),
          String(e['source_node_id']),
          String(e['target_node_id'])
        );
      }

      const insV = db.prepare(
        `INSERT INTO variables (id, name, type, value, is_secret, scope, description) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const v of variables) {
        const isSecret = Number(v['is_secret'] ?? 0) ? 1 : 0;
        const rawValue = String(v['value'] ?? '');
        insV.run(
          String(v['id']),
          String(v['name']),
          String(v['type'] ?? 'string'),
          isSecret ? encryptSecret(rawValue) : rawValue,
          isSecret,
          String(v['scope'] ?? 'global'),
          String(v['description'] ?? '').slice(0, 2000)
        );
      }

      const setS = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
      for (const row of settingsRows) {
        const key = row.key != null ? String(row.key) : '';
        if (!key || !SETTINGS_IMPORT_ALLOWLIST.has(key)) continue;
        setS.run(key, String(row.value ?? '').slice(0, MAX_SETTING_VALUE_LENGTH));
        settingsApplied += 1;
      }
    });

    tx();

    return {
      ok: true,
      workflows: workflows.length,
      variables: variables.length,
      settingsApplied,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
