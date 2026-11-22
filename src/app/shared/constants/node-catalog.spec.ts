import { describe, expect, it } from 'vitest';
import { defaultActionConfig, defaultConditionConfig, defaultTriggerConfig } from './catalog-defaults';
import { NODE_CATALOG } from './node-catalog';

describe('node catalog', () => {
  it('has a unique kind for every entry', () => {
    const kinds = NODE_CATALOG.map((entry) => entry.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('gives every catalog kind a real starter config, not the generic fallback', () => {
    for (const entry of NODE_CATALOG) {
      const config =
        entry.nodeType === 'trigger'
          ? defaultTriggerConfig(entry.kind)
          : entry.nodeType === 'condition'
            ? defaultConditionConfig(entry.kind)
            : defaultActionConfig(entry.kind);
      expect(config['label'], entry.kind).not.toBe(entry.kind);
      expect(String(config['label']).length).toBeGreaterThan(0);
    }
  });

  it('marks the paid trigger and action families as Pro', () => {
    const tier = (kind: string) => NODE_CATALOG.find((entry) => entry.kind === kind)?.tier;
    expect(tier('time_schedule')).toBe('free');
    expect(tier('show_notification')).toBe('free');
    expect(tier('branch_if')).toBe('free');
    for (const kind of ['file_change', 'webhook_trigger', 'http_request', 'delay_wait', 'slack_notification']) {
      expect(tier(kind), kind).toBe('pro');
    }
  });
});
