import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TfProIfDirective } from '../directives/tf-pro-if.directive';
import { ConfirmDialogService } from './confirm-dialog.service';
import { HotkeysService } from './hotkeys.service';
import { IpcService } from './ipc.service';
import { LoadingService } from './loading.service';
import { ToastService } from './toast.service';
import { AppComponent } from '../../app.component';

@Component({
  imports: [TfProIfDirective],
  template: `
    <ng-template #locked><p>locked</p></ng-template>
    <p *tfProIf="locked">open</p>
  `,
})
class ProHost {}

describe('shell services', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('shows a toast and removes it when the timer elapses', () => {
    vi.useFakeTimers();
    const toast = TestBed.inject(ToastService);
    toast.success('Saved');
    expect(toast.items()[0]?.message).toBe('Saved');
    expect(toast.items()[0]?.level).toBe('success');
    const id = toast.items()[0]!.id;
    toast.dismiss(id);
    expect(toast.items()).toEqual([]);
    toast.error('Nope');
    vi.advanceTimersByTime(4000);
    expect(toast.items()).toEqual([]);
    vi.useRealTimers();
  });

  it('resolves a confirm dialog from the response', async () => {
    const dialog = TestBed.inject(ConfirmDialogService);
    const pending = dialog.confirm({ title: 'Delete?', message: 'This cannot be undone', confirmLabel: 'Delete' });
    expect(dialog.active()?.title).toBe('Delete?');
    dialog.respond(false);
    await expect(pending).resolves.toBe(false);
    expect(dialog.active()).toBeNull();
  });

  it('keeps the busy flag set until nested work finishes', async () => {
    const loading = TestBed.inject(LoadingService);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outer = loading.run(async () => {
      await loading.run(async () => gate);
      return 'done';
    });
    expect(loading.globalBusy()).toBe(true);
    release();
    await expect(outer).resolves.toBe('done');
    expect(loading.globalBusy()).toBe(false);
  });

  it('publishes builder save and test-run shortcuts', () => {
    const hotkeys = TestBed.inject(HotkeysService);
    const saved = vi.fn();
    const ran = vi.fn();
    hotkeys.saveBuilder$.subscribe(saved);
    hotkeys.testRunBuilder$.subscribe(ran);
    hotkeys.saveBuilder$.next();
    hotkeys.testRunBuilder$.next();
    expect(saved).toHaveBeenCalledOnce();
    expect(ran).toHaveBeenCalledOnce();
  });

  it('applies locale, theme, and accent from settings in the desktop app', async () => {
    const ipc = {
      isElectron: true,
      api: {
        settings: {
          get: vi.fn(async (key: string) => {
            const values: Record<string, string> = { ui_locale: 'fr-FR', ui_theme: 'light', ui_accent: 'violet' };
            return values[key] ?? null;
          }),
        },
      },
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: IpcService, useValue: ipc }],
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.documentElement.lang).toBe('fr-FR');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--color-tf-green')).toBe('#a78bfa');
    document.documentElement.lang = 'en';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--color-tf-green');
  });

  it('shows Pro content in the browser and the locked template when the desktop key is missing', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: IpcService, useValue: { isElectron: false, api: {} } }],
    });
    const open = TestBed.createComponent(ProHost);
    open.detectChanges();
    await open.whenStable();
    open.detectChanges();
    expect(open.nativeElement.textContent).toContain('open');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: IpcService,
          useValue: { isElectron: true, api: { entitlement: { getStatus: async () => ({ unlocked: false }) } } },
        },
      ],
    });
    const locked = TestBed.createComponent(ProHost);
    locked.detectChanges();
    await locked.whenStable();
    locked.detectChanges();
    expect(locked.nativeElement.textContent).toContain('locked');
    expect(locked.nativeElement.textContent).not.toContain('open');
  });
});
