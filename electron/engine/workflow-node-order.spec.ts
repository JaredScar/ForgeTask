import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowNodeRow } from '../types';
import { orderWorkflowNodesForRun } from './workflow-node-order';

function node(id: string, sort: number): WorkflowNodeRow {
  return {
    id,
    workflow_id: 'w1',
    node_type: 'action',
    kind: 'show_notification',
    config: '{}',
    position_x: 0,
    position_y: 0,
    sort_order: sort,
  };
}

function dbWith(edges: Array<{ source_node_id: string; target_node_id: string }>) {
  return {
    prepare() {
      return { all: () => edges };
    },
  };
}

void test('orderWorkflowNodesForRun uses sort_order when the workflow has no edges', () => {
  const nodes = [node('b', 2), node('a', 0), node('c', 1)];
  const ordered = orderWorkflowNodesForRun(dbWith([]) as never, 'w1', nodes);
  assert.deepEqual(ordered.map((n) => n.id), ['a', 'c', 'b']);
});

void test('orderWorkflowNodesForRun walks edges and breaks ties by sort_order', () => {
  const nodes = [node('root', 0), node('later', 2), node('sooner', 1)];
  const edges = [
    { source_node_id: 'root', target_node_id: 'later' },
    { source_node_id: 'root', target_node_id: 'sooner' },
  ];
  const ordered = orderWorkflowNodesForRun(dbWith(edges) as never, 'w1', nodes);
  assert.deepEqual(ordered.map((n) => n.id), ['root', 'sooner', 'later']);
});

void test('orderWorkflowNodesForRun still includes nodes trapped in a cycle', () => {
  const nodes = [node('a', 0), node('b', 1)];
  const edges = [
    { source_node_id: 'a', target_node_id: 'b' },
    { source_node_id: 'b', target_node_id: 'a' },
  ];
  const ordered = orderWorkflowNodesForRun(dbWith(edges) as never, 'w1', nodes);
  assert.deepEqual(ordered.map((n) => n.id).sort(), ['a', 'b']);
});

void test('orderWorkflowNodesForRun ignores edges that point outside the node list', () => {
  const nodes = [node('only', 0)];
  const edges = [{ source_node_id: 'only', target_node_id: 'missing' }];
  const ordered = orderWorkflowNodesForRun(dbWith(edges) as never, 'w1', nodes);
  assert.deepEqual(ordered.map((n) => n.id), ['only']);
});
