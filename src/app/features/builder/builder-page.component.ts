import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { IpcService } from '../../core/services/ipc.service';
import { ToastService } from '../../core/services/toast.service';
import { HotkeysService } from '../../core/services/hotkeys.service';
import { isEntitlementRequiredError } from '../../core/utils/entitlement-error';
import type { WorkflowDto, WorkflowNodeDto } from '../../../types/taskforge-window';

@Component({
  selector: 'app-builder-page',
  imports: [FormsModule, DragDropModule, RouterLink],
  template: `
    @if (!workflow()) {
      <p class="text-tf-muted">Loading…</p>
    } @else {
      <div class="mx-auto max-w-lg">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <a routerLink="/workflows" class="text-xs text-tf-muted hover:text-tf-green">← Workflows</a>
            <input
              class="mt-1 block w-full border-none bg-transparent text-lg font-semibold outline-none"
              [ngModel]="workflow()!.name"
              (ngModelChange)="patchName($event)"
            />
            <div class="mt-1 flex gap-2 text-xs">
              <span class="rounded bg-neutral-700 px-2 py-0.5">{{ draft() ? 'Draft' : 'Saved' }}</span>
              <label class="flex items-center gap-1 text-tf-muted">
                <input type="checkbox" [(ngModel)]="debugMode" /> Debug Mode
              </label>
            </div>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              (click)="testRun()"
              class="rounded-lg border border-tf-border px-3 py-1.5 text-sm hover:bg-neutral-800"
            >
              Test Run
            </button>
            <button
              type="button"
              (click)="save()"
              class="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
            >
              Save
            </button>
          </div>
        </div>

        <div
          cdkDropList
          (cdkDropListDropped)="drop($event)"
          class="flex flex-col gap-0"
        >
          @for (n of nodes(); track n.id) {
            <div class="flex flex-col items-center">
              <div
                cdkDrag
                class="flex w-full cursor-grab rounded-xl border border-tf-border bg-tf-card p-4 active:cursor-grabbing"
                [class.ring-1]="selectedId() === n.id"
                [class.ring-tf-green]="selectedId() === n.id"
                (click)="select(n.id)"
              >
                <div class="mr-3 text-neutral-500" cdkDragHandle>⋮⋮</div>
                <div class="flex-1">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-tf-muted">{{ n.node_type }}</p>
                  <p class="font-medium">{{ label(n) }}</p>
                </div>
                <span class="text-xl text-tf-green">{{ icon(n.kind) }}</span>
              </div>
              <button
                type="button"
                (click)="insertAfter(n.id)"
                class="z-10 -my-2 flex h-8 w-8 items-center justify-center rounded-full border border-tf-border bg-tf-bg text-lg leading-none text-tf-green hover:bg-tf-card"
              >
                +
              </button>
            </div>
          }
        </div>

        @if (selected()) {
          <div class="mt-6 rounded-xl border border-tf-border bg-tf-card p-4">
            <h3 class="text-sm font-semibold">Node settings</h3>
            <label class="mt-3 block text-xs text-tf-muted">Config (JSON)</label>
            <textarea
              rows="6"
              class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg p-2 font-mono text-xs"
              [ngModel]="selectedConfigText()"
              (ngModelChange)="updateSelectedConfig($event)"
            ></textarea>
          </div>
        }
      </div>
    }
  `,
})
export class BuilderPageComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly hotkeys = inject(HotkeysService);
  private hotkeySubs: Subscription[] = [];

  protected readonly workflow = signal<WorkflowDto | null>(null);
  protected readonly nodes = signal<WorkflowNodeDto[]>([]);
  protected readonly draft = signal(true);
  protected readonly selectedId = signal<string | null>(null);
  protected debugMode = false;
  private wfId = '';

  protected selected(): WorkflowNodeDto | undefined {
    const id = this.selectedId();
    return id ? this.nodes().find((x) => x.id === id) : undefined;
  }

  protected selectedConfigText(): string {
    const n = this.selected();
    if (!n) return '';
    try {
      return JSON.stringify(JSON.parse(n.config), null, 2);
    } catch {
      return n.config;
    }
  }

  async ngOnInit(): Promise<void> {
    let id = this.route.snapshot.paramMap.get('id') ?? '';
    if (id === 'new') {
      id = await this.ipc.api.workflows.create({ name: 'Untitled workflow', description: '' });
      await this.router.navigate(['/builder', id], { replaceUrl: true });
    }
    this.wfId = id;
    await this.load();
    this.hotkeySubs = [
      this.hotkeys.saveBuilder$.subscribe(() => void this.save()),
      this.hotkeys.testRunBuilder$.subscribe(() => void this.testRun()),
    ];
  }

  ngOnDestroy(): void {
    for (const s of this.hotkeySubs) s.unsubscribe();
  }

  private async load(): Promise<void> {
    const data = await this.ipc.api.workflows.get(this.wfId);
    if (!data) return;
    this.workflow.set(data.workflow);
    this.nodes.set([...data.nodes].sort((a, b) => a.sort_order - b.sort_order));
    this.draft.set(!!data.workflow.draft);
  }

  protected label(n: WorkflowNodeDto): string {
    try {
      const c = JSON.parse(n.config) as { label?: string };
      return c.label ?? n.kind.replace(/_/g, ' ');
    } catch {
      return n.kind;
    }
  }

  protected icon(kind: string): string {
    const m: Record<string, string> = {
      time_schedule: '🕐',
      wifi_network: '📶',
      open_application: '🖥',
      show_notification: '🔔',
    };
    return m[kind] ?? '⚡';
  }

  protected patchName(name: string): void {
    const w = this.workflow();
    if (w) this.workflow.set({ ...w, name });
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected updateSelectedConfig(text: string): void {
    const id = this.selectedId();
    if (!id) return;
    this.nodes.update((list) => list.map((n) => (n.id === id ? { ...n, config: text } : n)));
  }

  protected drop(event: CdkDragDrop<WorkflowNodeDto[]>): void {
    const list = [...this.nodes()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    list.forEach((n, i) => (n.sort_order = i));
    this.nodes.set(list);
  }

  protected insertAfter(nodeId: string): void {
    const list = [...this.nodes()];
    const idx = list.findIndex((n) => n.id === nodeId);
    const newNode: WorkflowNodeDto = {
      id: crypto.randomUUID(),
      workflow_id: this.wfId,
      node_type: 'action',
      kind: 'show_notification',
      config: JSON.stringify({ title: 'TaskForge', body: 'Step', label: 'Show Notification' }),
      position_x: 0,
      position_y: 0,
      sort_order: idx + 1,
    };
    list.splice(idx + 1, 0, newNode);
    list.forEach((n, i) => (n.sort_order = i));
    this.nodes.set(list);
  }

  async save(): Promise<void> {
    const w = this.workflow();
    if (!w) return;
    try {
      await this.ipc.api.workflows.update({
        id: this.wfId,
        name: w.name,
        draft: false,
        nodes: this.nodes().map((n) => ({
          id: n.id,
          node_type: n.node_type,
          kind: n.kind,
          config: typeof n.config === 'string' ? JSON.parse(n.config) : n.config,
          position_x: n.position_x,
          position_y: n.position_y,
          sort_order: n.sort_order,
        })),
        edges: [],
      });
      this.draft.set(false);
      await this.load();
    } catch (e) {
      if (isEntitlementRequiredError(e)) {
        this.toast.warning('Pro license required to save workflows that use Pro triggers or actions. Add your key in Settings.');
        void this.router.navigate(['/settings'], { queryParams: { unlock: '1' } });
        return;
      }
      throw e;
    }
  }

  async testRun(): Promise<void> {
    await this.ipc.api.engine.runWorkflow(this.wfId);
  }
}
