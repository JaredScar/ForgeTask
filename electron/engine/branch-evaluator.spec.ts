import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowNodeRow } from '../types';
import { evaluateBranchIf } from './branch-evaluator';

function branch(config: Record<string, unknown>): WorkflowNodeRow {
  return {
    id: 'b1',
    workflow_id: 'w1',
    node_type: 'condition',
    kind: 'branch_if',
    config: JSON.stringify(config),
    position_x: 0,
    position_y: 0,
    sort_order: 0,
  };
}

void test('variable_equals passes only on an exact match', async () => {
  const pass = await evaluateBranchIf(branch({ checkKind: 'variable_equals', variable: 'env', value: 'prod' }), { env: 'prod' });
  assert.equal(pass.pass, true);
  const fail = await evaluateBranchIf(branch({ checkKind: 'variable_equals', variable: 'env', value: 'prod' }), { env: 'dev' });
  assert.equal(fail.pass, false);
  assert.match(fail.reason, /dev/);
});

void test('variable_contains rejects an empty needle', async () => {
  const result = await evaluateBranchIf(branch({ checkKind: 'variable_contains', variable: 'msg', value: '' }), { msg: 'hello' });
  assert.equal(result.pass, false);
});

void test('variable_contains matches a substring from context before variables', async () => {
  const result = await evaluateBranchIf(
    branch({ checkKind: 'variable_contains', variable: 'msg', value: 'ok' }),
    { msg: 'from-var' },
    { msg: 'status ok' }
  );
  assert.equal(result.pass, true);
});

void test('variable_truthy treats empty, 0, and false as fail', async () => {
  for (const value of ['', '0', 'false', 'FALSE']) {
    const result = await evaluateBranchIf(branch({ checkKind: 'variable_truthy', variable: 'flag' }), { flag: value });
    assert.equal(result.pass, false, value);
  }
  const result = await evaluateBranchIf(branch({ checkKind: 'variable_truthy', variable: 'flag' }), { flag: 'yes' });
  assert.equal(result.pass, true);
});

void test('invalid branch JSON fails closed', async () => {
  const node = branch({});
  node.config = '{';
  const result = await evaluateBranchIf(node);
  assert.equal(result.pass, false);
  assert.match(result.reason, /Invalid/);
});
