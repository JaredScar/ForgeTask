import type { WorkflowNodeRow } from '../types';
import { evaluateCondition } from './condition-evaluator';
import { interpolateConfigString } from './variable-interpolation';

function parseConfig(node: WorkflowNodeRow, vars: Record<string, string>, context: Record<string, string>) {
  try {
    const raw = interpolateConfigString(node.config, vars, context);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveVariable(name: string, vars: Record<string, string>, context: Record<string, string>): string {
  const key = name.trim();
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(context, key)) return context[key] ?? '';
  if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? '';
  return '';
}

/** Evaluates a `branch_if` node — returns which outgoing edge label to follow. */
export async function evaluateBranchIf(
  node: WorkflowNodeRow,
  vars: Record<string, string> = {},
  context: Record<string, string> = {}
): Promise<{ pass: boolean; reason: string }> {
  const config = parseConfig(node, vars, context);
  if (!config) return { pass: false, reason: 'Invalid branch config' };

  const checkKind = String(config['checkKind'] ?? 'variable_truthy');

  if (checkKind === 'variable_equals') {
    const variable = String(config['variable'] ?? '');
    const expected = String(config['value'] ?? '');
    const actual = resolveVariable(variable, vars, context);
    const pass = actual === expected;
    return pass
      ? { pass: true, reason: `${variable} equals "${expected}"` }
      : { pass: false, reason: `${variable} is "${actual}" (expected "${expected}")` };
  }

  if (checkKind === 'variable_contains') {
    const variable = String(config['variable'] ?? '');
    const needle = String(config['value'] ?? '');
    const actual = resolveVariable(variable, vars, context);
    const pass = needle.length > 0 && actual.includes(needle);
    return pass
      ? { pass: true, reason: `${variable} contains "${needle}"` }
      : { pass: false, reason: `${variable} does not contain "${needle}"` };
  }

  if (checkKind === 'variable_truthy') {
    const variable = String(config['variable'] ?? '');
    const actual = resolveVariable(variable, vars, context).trim();
    const pass = actual.length > 0 && actual !== '0' && actual.toLowerCase() !== 'false';
    return pass
      ? { pass: true, reason: `${variable} is truthy` }
      : { pass: false, reason: `${variable} is empty or falsy` };
  }

  const pseudo: WorkflowNodeRow = {
    ...node,
    kind: checkKind,
    config: JSON.stringify({
      ssid: config['ssid'],
      start: config['start'],
      end: config['end'],
      process: config['process'],
    }),
  };
  const r = await evaluateCondition(pseudo, vars, context);
  return r.ok ? { pass: true, reason: 'Condition matched' } : { pass: false, reason: r.reason ?? 'Condition failed' };
}
