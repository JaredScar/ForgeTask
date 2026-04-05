import type Database from 'better-sqlite3';
import type { WorkflowNodeRow } from '../types';

/** When `workflow_edges` is empty, uses `sort_order`. Otherwise runs a topological walk (ties broken by `sort_order`). */
export function orderWorkflowNodesForRun(
  db: Database.Database,
  workflowId: string,
  nodes: WorkflowNodeRow[]
): WorkflowNodeRow[] {
  const sorted = [...nodes].sort((a, b) => a.sort_order - b.sort_order);
  const edges = db
    .prepare(`SELECT source_node_id, target_node_id FROM workflow_edges WHERE workflow_id = ?`)
    .all(workflowId) as { source_node_id: string; target_node_id: string }[];
  if (edges.length === 0) return sorted;

  const idSet = new Set(sorted.map((n) => n.id));
  const nodeById = new Map(sorted.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of sorted) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!idSet.has(e.source_node_id) || !idSet.has(e.target_node_id)) continue;
    adj.get(e.source_node_id)!.push(e.target_node_id);
    indeg.set(e.target_node_id, (indeg.get(e.target_node_id) ?? 0) + 1);
  }

  const ready = new Set<string>();
  for (const n of sorted) {
    if ((indeg.get(n.id) ?? 0) === 0) ready.add(n.id);
  }

  const result: WorkflowNodeRow[] = [];
  const inResult = new Set<string>();

  while (ready.size) {
    const batch = [...ready]
      .map((id) => nodeById.get(id)!)
      .sort((a, b) => a.sort_order - b.sort_order);
    const pick = batch[0]!;
    ready.delete(pick.id);
    if (inResult.has(pick.id)) continue;
    inResult.add(pick.id);
    result.push(pick);
    for (const tid of adj.get(pick.id) ?? []) {
      indeg.set(tid, (indeg.get(tid) ?? 0) - 1);
      if ((indeg.get(tid) ?? 0) === 0) ready.add(tid);
    }
  }

  for (const n of sorted) {
    if (!inResult.has(n.id)) result.push(n);
  }
  return result;
}
