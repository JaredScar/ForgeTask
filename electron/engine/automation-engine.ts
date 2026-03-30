import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { WorkflowNodeRow } from '../types';
import { evaluateCondition } from './condition-evaluator';
import { executeActionNode } from './action-executor';
import { loadVariableMap } from './variable-interpolation';

export type WorkflowRunNotify = (payload: { logId: string; workflowId: string }) => void;

export class AutomationEngine {
  constructor(
    private readonly db: Database.Database,
    private readonly notifyRenderer?: WorkflowRunNotify
  ) {}

  async runWorkflow(workflowId: string, triggerKind?: string): Promise<string> {
    const logId = randomUUID();
    const started = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO execution_logs (id, workflow_id, started_at, finished_at, status, trigger_kind, message, error) VALUES (?, ?, ?, NULL, 'running', ?, NULL, NULL)`
      )
      .run(logId, workflowId, started, triggerKind ?? 'manual');

    const nodes = this.db
      .prepare(
        `SELECT id, workflow_id, node_type, kind, config, position_x, position_y, sort_order FROM workflow_nodes WHERE workflow_id = ? ORDER BY sort_order ASC`
      )
      .all(workflowId) as WorkflowNodeRow[];

    const vars = loadVariableMap(this.db);

    let finalStatus: 'success' | 'failure' | 'skipped' = 'success';
    let lastError: string | undefined;

    try {
      for (const node of nodes) {
        if (node.node_type === 'trigger') {
          this.insertStep(logId, node, 'success', 0, 'Trigger fired', undefined, undefined);
          continue;
        }
        if (node.node_type === 'condition') {
          const condStart = Date.now();
          const r = await evaluateCondition(node, vars);
          const dur = Date.now() - condStart;
          if (!r.ok) {
            finalStatus = 'skipped';
            lastError = r.reason;
            this.insertStep(logId, node, 'failure', dur, 'Condition failed', r.reason, undefined);
            break;
          }
          this.insertStep(logId, node, 'success', dur, 'Condition passed', undefined, undefined);
          continue;
        }
        if (node.node_type === 'action') {
          const ar = await executeActionNode(node, vars);
          this.insertStep(logId, node, ar.status, ar.durationMs, ar.message, ar.error, ar.output);
          if (ar.status === 'failure') {
            finalStatus = 'failure';
            lastError = ar.error;
          }
        }
      }

      const finished = new Date().toISOString();
      this.db
        .prepare(`UPDATE execution_logs SET finished_at = ?, status = ?, message = ?, error = ? WHERE id = ?`)
        .run(
          finished,
          finalStatus === 'skipped' ? 'skipped' : finalStatus,
          finalStatus === 'success' ? 'Workflow completed' : finalStatus === 'skipped' ? 'Skipped by condition' : 'Workflow failed',
          lastError ?? null,
          logId
        );

      const wf = this.db.prepare(`SELECT run_count FROM workflows WHERE id = ?`).get(workflowId) as { run_count: number };
      const summary =
        finalStatus === 'success'
          ? 'Completed successfully'
          : finalStatus === 'skipped'
            ? 'Skipped (condition)'
            : lastError ?? 'Failed';
      this.db
        .prepare(`UPDATE workflows SET run_count = ?, last_run_at = ?, last_run_summary = ?, updated_at = ? WHERE id = ?`)
        .run((wf?.run_count ?? 0) + 1, finished, summary, finished, workflowId);

      this.notifyRenderer?.({ logId, workflowId });
      return logId;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const finished = new Date().toISOString();
      this.db
        .prepare(`UPDATE execution_logs SET finished_at = ?, status = 'failure', message = ?, error = ? WHERE id = ?`)
        .run(finished, 'Engine error', err, logId);
      this.db
        .prepare(`UPDATE workflows SET last_run_at = ?, last_run_summary = ?, updated_at = ? WHERE id = ?`)
        .run(finished, 'Engine error: ' + err.slice(0, 120), finished, workflowId);
      this.notifyRenderer?.({ logId, workflowId });
      return logId;
    }
  }

  private insertStep(
    logId: string,
    node: WorkflowNodeRow,
    status: string,
    durationMs: number,
    message: string,
    error?: string,
    output?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO log_steps (id, log_id, step_type, step_kind, status, duration_ms, message, error, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), logId, node.node_type, node.kind, status, durationMs, message, error ?? null, output ?? null);
  }
}
