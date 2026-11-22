import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutgoingMap, findGraphStartNodeId, pickNextGraphEdge } from './workflow-graph.js';
import type { WorkflowNodeRow } from '../types';

function node(id: string, node_type: WorkflowNodeRow['node_type'], sort: number): WorkflowNodeRow {
  return {
    id,
    workflow_id: 'w1',
    node_type,
    kind: node_type === 'trigger' ? 'time_schedule' : 'show_notification',
    config: '{}',
    position_x: 0,
    position_y: 0,
    sort_order: sort,
  };
}

void test('pickNextGraphEdge follows true branch after branch_if', () => {
  const outgoing = [
    { source_node_id: 'a', target_node_id: 't', branch: 'true' },
    { source_node_id: 'a', target_node_id: 'f', branch: 'false' },
  ];
  const next = pickNextGraphEdge(outgoing, true);
  assert.equal(next?.target_node_id, 't');
});

void test('pickNextGraphEdge follows false branch after branch_if', () => {
  const outgoing = [
    { source_node_id: 'a', target_node_id: 't', branch: 'true' },
    { source_node_id: 'a', target_node_id: 'f', branch: 'false' },
  ];
  const next = pickNextGraphEdge(outgoing, false);
  assert.equal(next?.target_node_id, 'f');
});

void test('pickNextGraphEdge uses neutral edge when no branch hint', () => {
  const outgoing = [{ source_node_id: 'a', target_node_id: 'b', branch: null }];
  const next = pickNextGraphEdge(outgoing, null);
  assert.equal(next?.target_node_id, 'b');
});

void test('pickNextGraphEdge returns null when a branch has no matching edge', () => {
  const outgoing = [{ source_node_id: 'a', target_node_id: 't', branch: 'true' }];
  assert.equal(pickNextGraphEdge(outgoing, false), null);
  assert.equal(pickNextGraphEdge([], null), null);
});

void test('findGraphStartNodeId prefers the earliest trigger', () => {
  const nodes = [node('action', 'action', 0), node('late', 'trigger', 2), node('early', 'trigger', 1)];
  assert.equal(findGraphStartNodeId(nodes, []), 'early');
});

void test('findGraphStartNodeId falls back to a node with no incoming edge', () => {
  const nodes = [node('child', 'action', 0), node('root', 'action', 1)];
  const edges = [{ source_node_id: 'root', target_node_id: 'child', branch: null }];
  assert.equal(findGraphStartNodeId(nodes, edges), 'root');
});

void test('buildOutgoingMap groups edges by source', () => {
  const map = buildOutgoingMap([
    { source_node_id: 'a', target_node_id: 'b', branch: null },
    { source_node_id: 'a', target_node_id: 'c', branch: 'true' },
  ]);
  assert.equal(map.get('a')?.length, 2);
  assert.equal(map.has('b'), false);
});
