import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcService } from '../core/services/ipc.service';
import type { WorkflowDto } from '../../types/taskforge-window';
import { AppShellComponent } from '../shared/shell/app-shell.component';
import { EmptyStateComponent } from '../shared/ui/empty-state/empty-state.component';
import { CronBuilderComponent } from './builder/cron-builder/cron-builder.component';
import { NodeConfigFormComponent } from './builder/node-config-form/node-config-form.component';
import { NodePickerComponent } from './builder/node-picker/node-picker.component';
import { BuilderPageComponent } from './builder/builder-page.component';
import { ActionsPageComponent } from './actions/actions-page.component';
import { AiAssistantPageComponent } from './ai-assistant/ai-assistant-page.component';
import { AnalyticsPageComponent } from './analytics/analytics-page.component';
import { ApiAccessPageComponent } from './api-access/api-access-page.component';
import { AuditLogsPageComponent } from './audit-logs/audit-logs-page.component';
import { LogsPageComponent } from './logs/logs-page.component';
import { MarketplacePageComponent } from './marketplace/marketplace-page.component';
import { OnboardingPageComponent } from './onboarding/onboarding-page.component';
import { SettingsPageComponent } from './settings/settings-page.component';
import { TeamPageComponent } from './team/team-page.component';
import { TriggersPageComponent } from './triggers/triggers-page.component';
import { VariablesPageComponent } from './variables/variables-page.component';
import { WorkflowsPageComponent } from './workflows/workflows-page.component';
import { ToastService } from '../core/services/toast.service';

vi.mock('chart.js', () => ({
  Chart: class Chart {
    static register(): void {}
    data = { labels: [] as unknown[], datasets: [{ data: [] as number[] }] };
    update(): void {}
    destroy(): void {}
  },
  registerables: [],
}));

const workflow: WorkflowDto = {
  id: 'wf-1',
  name: 'Morning routine',
  description: 'Opens mail',
  enabled: 1,
  priority: 'normal',
  tags: '["home"]',
  draft: 0,
  run_count: 2,
  last_run_at: null,
  last_run_summary: 'Completed successfully',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  concurrency: 'allow',
};

function fakeIpc(options?: { team?: Array<{ is_self: number; role: string; display_name?: string }> }) {
  return {
    isElectron: false,
    api: {
      entitlement: {
        getStatus: vi.fn(async () => ({
          unlocked: true,
          licenseServerConfigured: false,
          licenseMode: 'local',
          seats: 5,
        })),
        setKey: vi.fn(async () => ({ ok: true })),
        refreshOnline: vi.fn(async () => ({ ok: true })),
      },
      team: { list: vi.fn(async () => options?.team ?? []), invite: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
      settings: { get: vi.fn(async () => null), set: vi.fn(async () => ({})), resetPreferences: vi.fn(async () => ({})) },
      workflows: {
        list: vi.fn(async () => [workflow]),
        get: vi.fn(async () => ({ workflow, nodes: [], edges: [] })),
        create: vi.fn(async () => 'wf-new'),
        createFromStarter: vi.fn(async () => 'wf-starter'),
        update: vi.fn(async () => true),
        delete: vi.fn(async () => ({})),
        setEnabled: vi.fn(async () => ({})),
        setReplayMissed: vi.fn(async () => ({})),
        toggle: vi.fn(async () => ({})),
        duplicate: vi.fn(async () => 'wf-copy'),
        appendNode: vi.fn(async () => true),
      },
      logs: {
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        export: vi.fn(async () => 'logs.csv'),
        clear: vi.fn(async () => ({})),
        onStepProgress: vi.fn(() => () => {}),
      },
      app: {
        onLogsNew: vi.fn(() => () => {}),
        getStats: vi.fn(async () => ({
          active: 0,
          queue: 0,
          triggerCount: 3,
          actionCount: 4,
          engineRunning: true,
          cpu: 1,
          memoryMb: 48,
          version: '2.2.0',
        })),
      },
      catalog: { usageByKind: vi.fn(async () => [{ kind: 'time_schedule', count: 2 }]) },
      variables: { list: vi.fn(async () => []), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) },
      marketplace: {
        list: vi.fn(async () => [
          { id: 'tmpl_meeting', title: 'Smart Meeting Prep', author: 'TaskForge', description: 'Prep a meeting', pro: false, installedCount: 0 },
        ]),
        install: vi.fn(async () => 'wf-installed'),
      },
      audit: { list: vi.fn(async () => []), export: vi.fn(async () => 'audit.csv') },
      api: {
        getKey: vi.fn(async () => 'tf_test_key'),
        listKeys: vi.fn(async () => []),
        createKey: vi.fn(async () => ({ token: 'tf_created' })),
        revokeKey: vi.fn(async () => ({})),
        regenerateKey: vi.fn(async () => 'tf_new'),
      },
      analytics: {
        getSummary: vi.fn(async () => ({
          totalRuns: 4,
          successRate: 75,
          avgDurationSec: 2,
          activeWorkflows: 1,
          trends: {
            totalRuns: { label: '+1', trend: 'up', favorable: true },
            successRate: { label: 'flat', trend: 'flat', favorable: true },
            avgDurationSec: { label: '-1s', trend: 'down', favorable: true },
            activeWorkflows: { label: '0', trend: 'flat', favorable: true },
          },
        })),
        getRunsByWorkflow: vi.fn(async () => [{ name: 'Morning routine', run_count: 2 }]),
        getRunsTimeSeries: vi.fn(async () => [{ day: '2026-11-01', count: 1 }]),
        getSystemHealth: vi.fn(async () => ({ cpu: 12, memory: 30, queue: 0, storageGb: 1 })),
      },
      ai: { onStreamToken: vi.fn(() => () => {}), parseStream: vi.fn(async () => ({ name: 'Draft', nodes: [] })) },
      data: {
        exportZip: vi.fn(async () => 'backup.zip'),
        importZip: vi.fn(async () => ({ ok: true })),
        importTaskScheduler: vi.fn(async () => ({ imported: 0 })),
        clearUserData: vi.fn(async () => ({})),
      },
      engine: { runWorkflow: vi.fn(async () => 'log-1') },
    },
  };
}

function routeStub() {
  const params = convertToParamMap({ id: 'wf-1' });
  const query = convertToParamMap({});
  return { snapshot: { paramMap: params, queryParamMap: query }, paramMap: of(params), queryParamMap: of(query) };
}

async function mount<T>(component: Type<T>, ipc = fakeIpc(), wait = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'workflows', component: WorkflowsPageComponent },
        { path: 'builder/:id', component: BuilderPageComponent },
        { path: 'marketplace', component: MarketplacePageComponent },
        { path: 'settings', component: SettingsPageComponent },
        { path: 'onboarding', component: OnboardingPageComponent },
      ]),
      { provide: ActivatedRoute, useValue: routeStub() },
      { provide: IpcService, useValue: ipc },
    ],
  });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  if (wait) {
    await fixture.whenStable();
    fixture.detectChanges();
  }
  return { fixture, ipc };
}

describe('app screens', () => {
  beforeEach(() => {
    localStorage.setItem('taskforge_onboarding_done', '1');
  });

  it('lists a workflow, filters it out, and starts a new one', async () => {
    const { fixture, ipc } = await mount(WorkflowsPageComponent);
    expect(fixture.nativeElement.textContent).toContain('Morning routine');
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="search"]');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No workflows match');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const create = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('New Workflow')
    ) as HTMLButtonElement;
    create.click();
    await fixture.whenStable();
    expect(ipc.api.workflows.create).toHaveBeenCalled();
  });

  it('shows the empty workflows state when nothing is saved', async () => {
    const ipc = fakeIpc();
    ipc.api.workflows.list.mockResolvedValue([]);
    const { fixture } = await mount(WorkflowsPageComponent, ipc);
    expect(fixture.nativeElement.textContent).toContain('No workflows yet');
  });

  it('opens the builder for the workflow in the route', async () => {
    const { fixture } = await mount(BuilderPageComponent);
    const name = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(name.value).toBe('Morning routine');
    expect(fixture.nativeElement.textContent).toContain('Saved');
  });

  it('creates a workflow from the first trigger and blocks viewers', async () => {
    const owner = await mount(TriggersPageComponent);
    expect(owner.fixture.nativeElement.textContent).toContain('Webhook');
    expect(owner.fixture.nativeElement.textContent).toContain('Used in 2 workflow');
    const start = [...owner.fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('New workflow with this trigger')
    ) as HTMLButtonElement;
    start.click();
    await owner.fixture.whenStable();
    expect(owner.ipc.api.workflows.createFromStarter).toHaveBeenCalledWith({
      mode: 'trigger',
      kind: 'time_schedule',
      displayTitle: 'Time Schedule',
    });

    const viewerIpc = fakeIpc({ team: [{ is_self: 1, role: 'Viewer', display_name: 'Ada' }] });
    const viewer = await mount(TriggersPageComponent, viewerIpc);
    const viewerButton = [...viewer.fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('New workflow with this trigger')
    ) as HTMLButtonElement;
    expect(viewerButton.disabled).toBe(true);
  });

  it('creates a workflow from an action card', async () => {
    const { fixture, ipc } = await mount(ActionsPageComponent);
    expect(fixture.nativeElement.textContent).toContain('Send email');
    expect(fixture.nativeElement.textContent).toContain('Keyboard / mouse');
    const start = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('New workflow with this action')
    ) as HTMLButtonElement;
    start.click();
    await fixture.whenStable();
    expect(ipc.api.workflows.createFromStarter).toHaveBeenCalledWith({
      mode: 'action',
      kind: 'open_application',
      displayTitle: 'Open Application',
    });
  });

  it('renders settings, logs, variables, team, marketplace, audit, api, analytics, and the assistant', async () => {
    const pages: Array<[Type<unknown>, string]> = [
      [SettingsPageComponent, 'Application preferences'],
      [LogsPageComponent, 'No execution logs yet'],
      [VariablesPageComponent, 'No variables yet'],
      [TeamPageComponent, 'No team members yet'],
      [AuditLogsPageComponent, 'No audit entries'],
      [ApiAccessPageComponent, 'Trigger workflows programmatically'],
      [AnalyticsPageComponent, 'Analytics Dashboard'],
      [AiAssistantPageComponent, 'Open Spotify when I plug in headphones'],
    ];
    for (const [component, text] of pages) {
      TestBed.resetTestingModule();
      const { fixture } = await mount(component);
      expect(fixture.nativeElement.textContent, component.name).toContain(text);
    }

    TestBed.resetTestingModule();
    const market = await mount(MarketplacePageComponent);
    expect(market.fixture.nativeElement.textContent).toContain('Smart Meeting Prep');
    const install = [...market.fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Install template')
    ) as HTMLButtonElement;
    install.click();
    await market.fixture.whenStable();
    expect(market.ipc.api.marketplace.install).toHaveBeenCalledWith('tmpl_meeting');
  });

  it('walks onboarding into the builder and records that it was dismissed', async () => {
    const { fixture } = await mount(OnboardingPageComponent);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const build = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Build from scratch')
    ) as HTMLButtonElement;
    build.click();
    expect(localStorage.getItem('forgetask_onboarding_done')).toBe('1');
    expect(navigate).toHaveBeenCalledWith(['/builder', 'new']);
  });

  it('shows the shell, the shortcut legend, and creates a workflow from Ctrl+N', async () => {
    const { fixture, ipc } = await mount(AppShellComponent, fakeIpc(), false);
    expect(fixture.nativeElement.textContent).toContain('ForgeTask');
    expect(fixture.nativeElement.textContent).toContain('Workflows');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Keyboard shortcuts');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Keyboard shortcuts');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    expect(ipc.api.workflows.create).toHaveBeenCalled();
    fixture.destroy();
  });

  it('lets a free node be picked and explains why a Pro node is locked', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: IpcService, useValue: fakeIpc() }],
    });
    const fixture = TestBed.createComponent(NodePickerComponent);
    fixture.componentRef.setInput('proUnlocked', () => false);
    const picked: unknown[] = [];
    fixture.componentInstance.picked.subscribe((value) => picked.push(value));
    fixture.detectChanges();
    const time = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Time schedule')
    ) as HTMLButtonElement;
    time.click();
    expect(picked).toHaveLength(1);

    const webhook = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Webhook')
    ) as HTMLButtonElement;
    webhook.click();
    expect(picked).toHaveLength(1);
    expect(TestBed.inject(ToastService).items()[0]?.message).toMatch(/Pro license/);
  });

  it('previews a cron preset and edits a notification in the config form', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const cron = TestBed.createComponent(CronBuilderComponent);
    const changes: string[] = [];
    cron.componentInstance.cronChange.subscribe((value) => changes.push(value));
    cron.componentRef.setInput('cron', '0 9 * * *');
    cron.detectChanges();
    expect(cron.nativeElement.textContent).toContain('Every day at 9:00 AM');
    const hourly = [...cron.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Every hour')
    ) as HTMLButtonElement;
    hourly.click();
    expect(changes.at(-1)).toBe('0 * * * *');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: IpcService, useValue: { isElectron: false, api: {} } }],
    });
    const form = TestBed.createComponent(NodeConfigFormComponent);
    const models: Record<string, unknown>[] = [];
    form.componentInstance.modelChange.subscribe((value) => models.push(value));
    form.componentRef.setInput('kind', 'show_notification');
    form.componentRef.setInput('model', { title: 'Hi', body: 'There' });
    form.detectChanges();
    const title = form.nativeElement.querySelectorAll('input')[1] as HTMLInputElement;
    title.value = 'Hello';
    title.dispatchEvent(new Event('input'));
    form.detectChanges();
    expect(models.at(-1)?.['title']).toBe('Hello');

    const empty = TestBed.createComponent(EmptyStateComponent);
    empty.componentRef.setInput('title', 'Nothing here');
    empty.componentRef.setInput('description', 'Add one');
    empty.componentRef.setInput('ctaLabel', 'Go');
    empty.componentRef.setInput('ctaRoute', '/workflows');
    empty.detectChanges();
    expect(empty.nativeElement.textContent).toContain('Nothing here');
    expect(empty.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/workflows');
  });
});
