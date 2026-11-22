import { describe, expect, it } from 'vitest';
import type { Route } from '@angular/router';
import { routes } from './app.routes';
import { proEntitlementGuard } from './core/guards/pro-entitlement.guard';
import { viewerBlockGuard } from './core/guards/viewer-block.guard';

function childRoutes(): Route[] {
  return routes[0]?.children ?? [];
}

function route(path: string): Route {
  const found = childRoutes().find((r) => r.path === path);
  if (!found) throw new Error(`missing route ${path}`);
  return found;
}

describe('app routes', () => {
  it('opens the app on the workflows list', () => {
    const home = childRoutes().find((r) => r.path === '');
    expect(home?.redirectTo).toBe('workflows');
    expect(home?.pathMatch).toBe('full');
  });

  it('registers every primary screen', () => {
    const paths = childRoutes().map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'onboarding',
        'workflows',
        'builder/:id',
        'triggers',
        'actions',
        'logs',
        'variables',
        'analytics',
        'marketplace',
        'ai-assistant',
        'team',
        'api-access',
        'audit-logs',
        'settings',
      ])
    );
  });

  it('keeps free screens open and gates Pro screens', () => {
    for (const path of ['workflows', 'triggers', 'actions', 'logs', 'settings', 'onboarding']) {
      expect(route(path).canActivate ?? []).not.toContain(proEntitlementGuard);
    }
    for (const path of ['variables', 'analytics', 'marketplace', 'ai-assistant', 'team', 'api-access', 'audit-logs']) {
      expect(route(path).canActivate).toContain(proEntitlementGuard);
    }
  });

  it('blocks viewers from the builder and variables, and tells them why', () => {
    expect(route('builder/:id').canActivate).toContain(viewerBlockGuard);
    expect(route('variables').canActivate).toContain(viewerBlockGuard);
    expect(route('variables').data?.['viewerBlockMessage']).toMatch(/variables/i);
    expect(route('analytics').canActivate ?? []).not.toContain(viewerBlockGuard);
  });
});
