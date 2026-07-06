import type { WorkflowNodeRow } from '../types';

export type WorkflowGraphEdge = {
  source_node_id: string;
  target_node_id: string;
  branch: string | null;
};

export function loadWorkflowGraphEdges(
  db: { prepare: (sql: string) => { all: (id: string) => unknown[] } },
  workflowId: string
): WorkflowGraphEdge[] {
  const rows = db
    .prepare(`SELECT source_node_id, target_node_id, branch FROM workflow_edges WHERE workflow_id = ?`)
    .all(workflowId) as WorkflowGraphEdge[];
  return rows.map((r) => ({
    source_node_id: r.source_node_id,
    target_node_id: r.target_node_id,
    branch: r.branch ?? null,
  }));
}

export function buildOutgoingMap(edges: WorkflowGraphEdge[]): Map<string, WorkflowGraphEdge[]> {
  const adj = new Map<string, WorkflowGraphEdge[]>();
  for (const e of edges) {
    const list = adj.get(e.source_node_id) ?? [];
    list.push(e);
    adj.set(e.source_node_id, list);
  }
  return adj;
}

export function findGraphStartNodeId(nodes: WorkflowNodeRow[], edges: WorkflowGraphEdge[]): string | null {
  const triggers = nodes.filter((n) => n.node_type === 'trigger').sort((a, b) => a.sort_order - b.sort_order);
  if (triggers.length) return triggers[0]!.id;

  const targets = new Set(edges.map((e) => e.target_node_id));
  const roots = nodes.filter((n) => !targets.has(n.id)).sort((a, b) => a.sort_order - b.sort_order);
  return roots[0]?.id ?? nodes.sort((a, b) => a.sort_order - b.sort_order)[0]?.id ?? null;
}

/** Pick the next edge after a node; `branchPass` is set when leaving a `branch_if` node. */
export function pickNextGraphEdge(
  outgoing: WorkflowGraphEdge[],
  branchPass: boolean | null
): WorkflowGraphEdge | null {
  if (!outgoing.length) return null;

  const labeled = outgoing.filter((e) => e.branch === 'true' || e.branch === 'false');
  if (labeled.length && branchPass !== null) {
    const want = branchPass ? 'true' : 'false';
    return outgoing.find((e) => e.branch === want) ?? null;
  }

  const neutral = outgoing.filter((e) => !e.branch);
  return neutral[0] ?? outgoing[0] ?? null;
}
