import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { shell } from 'electron';
import type { WorkflowNodeRow } from '../types';
import { evaluateCondition } from './condition-evaluator';
import { evaluateBranchIf } from './branch-evaluator';
import { executeActionNode } from './action-executor';
import { loadVariableMap } from './variable-interpolation';
import { orderWorkflowNodesForRun } from './workflow-node-order';
import {
  buildOutgoingMap,
  findGraphStartNodeId,
  loadWorkflowGraphEdges,
  pickNextGraphEdge,
} from './workflow-graph';

export type WorkflowRunNotify = (payload: { logId: string; workflowId: string }) => void;

export type StepProgressPayload = {
  logId: string;
  workflowId: string;
  stepIndex: number;
  stepType: string;
  stepKind: string;
  status: string;
  message: string;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class AutomationEngine {
  private readonly running = new Set<string>();
  private readonly pending = new Map<string, Array<{ triggerKind?: string }>>();
  private runStepIndex = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly notifyRenderer?: WorkflowRunNotify,
    private readonly notifyStepProgress?: (payload: StepProgressPayload) => void
  ) {}

  /** In-memory runs waiting behind `concurrency: queue` (not yet written to `execution_logs`). */
  getQueuedRunCount(): number {
    let n = 0;
    for (const q of this.pending.values()) {
      n += q.length;
    }
    return n;
  }

  private getConcurrency(workflowId: string): 'allow' | 'queue' | 'skip' {
    const row = this.db.prepare(`SELECT concurrency FROM workflows WHERE id = ?`).get(workflowId) as
      | { concurrency: string }
      | undefined;
    const v = (row?.concurrency ?? 'allow').toLowerCase();
    if (v === 'queue' || v === 'skip') return v;
    return 'allow';
  }

  private workflowExists(workflowId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM workflows WHERE id = ?`).get(workflowId);
  }

  private insertSkippedLog(workflowId: string, triggerKind?: string): string {
    const logId = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO execution_logs (id, workflow_id, started_at, finished_at, status, trigger_kind, message, error) VALUES (?, ?, ?, ?, 'skipped', ?, ?, NULL)`
      )
      .run(logId, workflowId, now, now, triggerKind ?? 'manual', 'Skipped — workflow already running');
    this.notifyRenderer?.({ logId, workflowId });
    return logId;
  }

  async runWorkflow(workflowId: string, triggerKind?: string, internal = false): Promise<string> {
    if (!this.workflowExists(workflowId)) {
      throw new Error(`workflow not found: ${workflowId}`);
    }
    const mode = this.getConcurrency(workflowId);

    if (!internal && mode === 'skip' && this.running.has(workflowId)) {
      return this.insertSkippedLog(workflowId, triggerKind);
    }

    if (!internal && mode === 'queue' && this.running.has(workflowId)) {
      const q = this.pending.get(workflowId) ?? [];
      q.push({ triggerKind });
      this.pending.set(workflowId, q);
      return '';
    }

    this.running.add(workflowId);
    let logId = '';
    try {
      logId = await this.executeWorkflowRun(workflowId, triggerKind);
    } finally {
      this.running.delete(workflowId);
      if (mode === 'queue') {
        const q = this.pending.get(workflowId);
        const next = q?.shift();
        if (next) void this.runWorkflow(workflowId, next.triggerKind, true);
        if (q && q.length === 0) this.pending.delete(workflowId);
      }
    }
    return logId;
  }

  private async executeWorkflowRun(workflowId: string, triggerKind?: string): Promise<string> {
    this.runStepIndex = 0;
    const logId = randomUUID();
    const started = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO execution_logs (id, workflow_id, started_at, finished_at, status, trigger_kind, message, error) VALUES (?, ?, ?, NULL, 'running', ?, NULL, NULL)`
      )
      .run(logId, workflowId, started, triggerKind ?? 'manual');

    /* So the renderer can show the running row and live step panel before the run finishes. */
    this.notifyRenderer?.({ logId, workflowId });

    const rawNodes = this.db
      .prepare(
        `SELECT id, workflow_id, node_type, kind, config, position_x, position_y, sort_order FROM workflow_nodes WHERE workflow_id = ? ORDER BY sort_order ASC`
      )
      .all(workflowId) as WorkflowNodeRow[];
    const nodes = orderWorkflowNodesForRun(this.db, workflowId, rawNodes);

    const vars = loadVariableMap(this.db);
    const context: Record<string, string> = {};

    let finalStatus = 'success' as 'success' | 'failure' | 'skipped';
    let lastError: string | undefined;
    let runStopped = false;

    const manualTestRun = triggerKind === 'manual';
    const graphEdges = loadWorkflowGraphEdges(this.db, workflowId);
    const useGraph = graphEdges.length > 0;
    const nodeById = new Map(rawNodes.map((n) => [n.id, n]));
    const outgoing = buildOutgoingMap(graphEdges);

    try {
      if (useGraph) {
        let currentId: string | null = findGraphStartNodeId(rawNodes, graphEdges);
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          const node = nodeById.get(currentId);
          if (!node) break;
          const branchPass = await this.runWorkflowNode(
            logId,
            workflowId,
            node,
            vars,
            context,
            manualTestRun,
            (status, err) => {
              finalStatus = status;
              lastError = err;
              runStopped = true;
            }
          );
          if (runStopped) break;
          const next = pickNextGraphEdge(outgoing.get(currentId) ?? [], branchPass);
          currentId = next?.target_node_id ?? null;
        }
      } else {
        for (const node of nodes) {
          const branchPass = await this.runWorkflowNode(
            logId,
            workflowId,
            node,
            vars,
            context,
            manualTestRun,
            (status, err) => {
              finalStatus = status;
              lastError = err;
              runStopped = true;
            }
          );
          if (runStopped) break;
          void branchPass;
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

      if (finalStatus === 'failure') {
        const soundOn = (
          this.db.prepare(`SELECT value FROM settings WHERE key = 'sound_on_workflow_failure'`).get() as { value: string } | undefined
        )?.value;
        if (soundOn === '1' || soundOn === 'true') {
          try {
            shell.beep();
          } catch {
            /* ignore */
          }
        }
      }

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

  /**
   * Runs one workflow node. Returns branch routing hint for `branch_if` nodes (`true`/`false`), else `null`.
   * Invokes `onTerminal` when the workflow should stop (failure or legacy condition skip).
   */
  private async runWorkflowNode(
    logId: string,
    workflowId: string,
    node: WorkflowNodeRow,
    vars: Record<string, string>,
    context: Record<string, string>,
    manualTestRun: boolean,
    onTerminal: (status: 'failure' | 'skipped', err?: string) => void
  ): Promise<boolean | null> {
    if (node.node_type === 'trigger') {
      if (manualTestRun) return null;
      this.insertStep(logId, workflowId, node, 'success', 0, 'Trigger fired', undefined, undefined);
      return null;
    }

    if (node.node_type === 'condition') {
      const condStart = Date.now();
      if (node.kind === 'branch_if') {
        const r = await evaluateBranchIf(node, vars, context);
        const dur = Date.now() - condStart;
        this.insertStep(
          logId,
          workflowId,
          node,
          'success',
          dur,
          r.pass ? 'Branch: true path' : 'Branch: false path',
          undefined,
          r.reason
        );
        return r.pass;
      }
      const r = await evaluateCondition(node, vars, context);
      const dur = Date.now() - condStart;
      if (!r.ok) {
        onTerminal('skipped', r.reason);
        this.insertStep(logId, workflowId, node, 'failure', dur, 'Condition failed', r.reason, undefined);
        return null;
      }
      this.insertStep(logId, workflowId, node, 'success', dur, 'Condition passed', undefined, undefined);
      return null;
    }

    if (node.node_type === 'action') {
      let cfg: Record<string, unknown> = {};
      try {
        cfg = JSON.parse(node.config) as Record<string, unknown>;
      } catch {
        cfg = {};
      }
      const maxRetries = Math.min(10, Math.max(0, Number(cfg['retryCount'] ?? 0)));
      const retryDelayMs = Math.min(60_000, Math.max(0, Number(cfg['retryDelayMs'] ?? 1000)));

      let ar = await executeActionNode(node, vars, context, this.db);
      let attempts = 0;
      while (ar.status === 'failure' && attempts < maxRetries) {
        attempts++;
        this.insertStep(logId, workflowId, node, 'retrying', 0, `Retry ${attempts}/${maxRetries}`, ar.error, undefined);
        if (retryDelayMs > 0) await sleep(retryDelayMs);
        ar = await executeActionNode(node, vars, context, this.db);
      }

      this.insertStep(logId, workflowId, node, ar.status, ar.durationMs, ar.message, ar.error, ar.output);
      if (ar.status === 'failure') {
        onTerminal('failure', ar.error);
      } else {
        if (node.kind === 'http_request' && ar.output != null && ar.output !== '') {
          context.responseBody = ar.output;
        }
        if (node.kind === 'run_script' && ar.output != null && ar.output !== '') {
          context.stdout = ar.output;
        }
        if (node.kind === 'zip_archive' && ar.output != null && ar.output !== '') {
          context.zipPath = ar.output;
        }
        if (node.kind === 'download_file') {
          const dest = String(cfg['destinationPath'] ?? '').trim();
          if (dest) context.downloadPath = dest;
          if (ar.output != null && ar.output !== '') context.downloadBytes = ar.output;
        }
        if (node.kind === 'tcp_port_check' && ar.output != null && ar.output !== '') {
          context.portOpen = ar.output;
        }
        if (node.kind === 'screenshot_save' && ar.output != null && ar.output !== '') {
          context.screenshotPath = ar.output;
        }
      }
    }
    return null;
  }

  private insertStep(
    logId: string,
    workflowId: string,
    node: WorkflowNodeRow,
    status: string,
    durationMs: number,
    message: string,
    error?: string,
    output?: string
  ): void {
    const stepIndex = this.runStepIndex++;
    this.db
      .prepare(
        `INSERT INTO log_steps (id, log_id, step_type, step_kind, status, duration_ms, message, error, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), logId, node.node_type, node.kind, status, durationMs, message, error ?? null, output ?? null);
    this.notifyStepProgress?.({
      logId,
      workflowId,
      stepIndex,
      stepType: node.node_type,
      stepKind: node.kind,
      status,
      message,
      error,
    });
  }
}
