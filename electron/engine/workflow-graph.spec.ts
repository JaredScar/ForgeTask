import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNextGraphEdge } from './workflow-graph.js';

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
