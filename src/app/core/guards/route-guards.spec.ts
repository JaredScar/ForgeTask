import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcService } from '../services/ipc.service';
import { ToastService } from '../services/toast.service';
import { proEntitlementGuard } from './pro-entitlement.guard';
import { viewerBlockGuard } from './viewer-block.guard';

type Status = { unlocked: boolean };
type Member = { is_self?: number; role?: string };

function setup(options: { electron?: boolean; status?: Status | Error; team?: Member[] | Error }) {
  const ipc = {
    isElectron: options.electron ?? true,
    api: {
      entitlement: {
        getStatus: vi.fn(async () => {
          if (options.status instanceof Error) throw options.status;
          return options.status ?? { unlocked: false };
        }),
      },
      team: {
        list: vi.fn(async () => {
          if (options.team instanceof Error) throw options.team;
          return options.team ?? [];
        }),
      },
    },
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), ToastService, { provide: IpcService, useValue: ipc }],
  });
  return ipc;
}

function snapshot(data: Record<string, unknown> = {}): ActivatedRouteSnapshot {
  return { data } as ActivatedRouteSnapshot;
}

describe('proEntitlementGuard', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('allows a route when Pro is unlocked', async () => {
    setup({ status: { unlocked: true } });
    const result = await TestBed.runInInjectionContext(() => proEntitlementGuard(snapshot(), {} as RouterStateSnapshot));
    expect(result).toBe(true);
  });

  it('sends a locked user to Settings', async () => {
    setup({ status: { unlocked: false } });
    const result = await TestBed.runInInjectionContext(() => proEntitlementGuard(snapshot(), {} as RouterStateSnapshot));
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toBe('/settings?unlock=1');
  });

  it('treats a status failure as locked', async () => {
    setup({ status: new Error('ipc down') });
    const result = await TestBed.runInInjectionContext(() => proEntitlementGuard(snapshot(), {} as RouterStateSnapshot));
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/settings');
  });
});

describe('viewerBlockGuard', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('allows browser preview and locked accounts through', async () => {
    setup({ electron: false, status: { unlocked: true }, team: [{ is_self: 1, role: 'Viewer' }] });
    const browser = await TestBed.runInInjectionContext(() => viewerBlockGuard(snapshot(), {} as RouterStateSnapshot));
    expect(browser).toBe(true);

    TestBed.resetTestingModule();
    setup({ status: { unlocked: false }, team: [{ is_self: 1, role: 'Viewer' }] });
    const locked = await TestBed.runInInjectionContext(() => viewerBlockGuard(snapshot(), {} as RouterStateSnapshot));
    expect(locked).toBe(true);
  });

  it('blocks a viewer and shows the route message', async () => {
    setup({ status: { unlocked: true }, team: [{ is_self: 1, role: 'Viewer' }] });
    const toast = TestBed.inject(ToastService);
    const warn = vi.spyOn(toast, 'warning');
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = await TestBed.runInInjectionContext(() =>
      viewerBlockGuard(
        snapshot({ viewerBlockMessage: 'Viewers cannot manage variables.', viewerRedirect: ['/workflows'] }),
        {} as RouterStateSnapshot
      )
    );

    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith('Viewers cannot manage variables.');
    expect(navigate).toHaveBeenCalledWith(['/workflows']);
  });

  it('allows the device owner to edit', async () => {
    setup({ status: { unlocked: true }, team: [{ is_self: 1, role: 'Owner' }] });
    const result = await TestBed.runInInjectionContext(() => viewerBlockGuard(snapshot(), {} as RouterStateSnapshot));
    expect(result).toBe(true);
  });
});
