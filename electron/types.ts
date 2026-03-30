import type Database from 'better-sqlite3';

export type NodeType = 'trigger' | 'condition' | 'action';

export interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  priority: string;
  tags: string;
  draft: number;
  run_count: number;
  last_run_at: string | null;
  last_run_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNodeRow {
  id: string;
  workflow_id: string;
  node_type: NodeType;
  kind: string;
  config: string;
  position_x: number;
  position_y: number;
  sort_order: number;
}

export type AutomationEngineContext = {
  db: Database.Database;
};
