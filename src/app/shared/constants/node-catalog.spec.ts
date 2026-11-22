import { describe, expect, it } from 'vitest';
import { ACTION_PAGE_ADVANCED, ACTION_PAGE_BASIC } from '../../features/actions/actions-page.component';
import { TRIGGER_PAGE_ADVANCED, TRIGGER_PAGE_BASIC } from '../../features/triggers/triggers-page.component';
import { defaultActionConfig, defaultConditionConfig, defaultTriggerConfig } from './catalog-defaults';
import { NODE_CATALOG } from './node-catalog';
import { schemaForKind } from './node-schemas';

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

  it('gives every catalog kind a config form', () => {
    for (const entry of NODE_CATALOG) {
      expect(schemaForKind(entry.kind)?.length, entry.kind).toBeGreaterThan(0);
    }
  });

  it('lists every trigger and action on the catalog pages', () => {
    const triggers = new Set([...TRIGGER_PAGE_BASIC, ...TRIGGER_PAGE_ADVANCED].map((item) => item.kind));
    const actions = new Set([...ACTION_PAGE_BASIC, ...ACTION_PAGE_ADVANCED].map((item) => item.kind));
    for (const entry of NODE_CATALOG) {
      if (entry.nodeType === 'trigger') expect(triggers.has(entry.kind), entry.kind).toBe(true);
      if (entry.nodeType === 'action') expect(actions.has(entry.kind), entry.kind).toBe(true);
    }
  });
});
