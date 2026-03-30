import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../core/services/ipc.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';

type VarRow = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  value: string;
  is_secret: number;
  scope: string;
};

@Component({
  selector: 'app-variables-page',
  imports: [FormsModule, EmptyStateComponent],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold">Variables</h1>
          <p class="mt-1 text-sm text-tf-muted">Store and reuse values across workflows</p>
        </div>
        <div class="flex gap-2">
          <label class="flex items-center gap-2 text-sm text-tf-muted">
            <input type="checkbox" [(ngModel)]="showSecrets" /> Show secrets
          </label>
          <button
            type="button"
            (click)="openAdd = true"
            class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
          >
            + Add Variable
          </button>
        </div>
      </div>
      @if (list().length === 0) {
        <app-empty-state
          icon="🔤"
          title="No variables yet"
          description="Reference variables from workflow node configs; values are substituted when the engine runs."
        />
        <div class="mt-4 flex justify-center">
          <button
            type="button"
            (click)="openAdd = true"
            class="rounded-lg bg-tf-green px-4 py-2 text-sm font-medium text-black"
          >
            + Add variable
          </button>
        </div>
      } @else {
      <div class="mt-4 space-y-2">
        @for (v of list(); track v.id) {
          <div class="rounded-xl border border-tf-border bg-tf-card p-3">
            @if (editingId() === v.id) {
              <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="min-w-0 flex-1 space-y-2">
                  <label class="block text-xs text-tf-muted">Name</label>
                  <input [(ngModel)]="editForm.name" class="w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm" />
                  <label class="block text-xs text-tf-muted">Type</label>
                  <select [(ngModel)]="editForm.type" class="w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm">
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="secret">secret</option>
                  </select>
                  <label class="block text-xs text-tf-muted">Value</label>
                  <input [(ngModel)]="editForm.value" class="w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm" />
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" [(ngModel)]="editForm.is_secret" /> Secret
                  </label>
                </div>
                <div class="flex shrink-0 gap-2">
                  <button type="button" class="rounded-lg border border-tf-border px-3 py-2 text-sm" (click)="cancelEdit()">Cancel</button>
                  <button type="button" class="rounded-lg bg-tf-green px-3 py-2 text-sm font-medium text-black" (click)="saveEdit(v.id)">
                    Save
                  </button>
                </div>
              </div>
            } @else {
              <div class="flex items-center gap-3">
                <span class="text-lg">{{ typeIcon(v.type) }}</span>
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-sm font-medium">{{ v.name }}</div>
                  <div class="mt-1 flex flex-wrap gap-2">
                    <span class="rounded bg-neutral-800 px-2 py-0.5 text-[10px]">{{ v.type }}</span>
                    <span class="rounded bg-neutral-800 px-2 py-0.5 text-[10px]">{{ v.scope }}</span>
                  </div>
                </div>
                <div class="max-w-xs truncate font-mono text-sm text-neutral-400">
                  @if (v.is_secret && !showSecrets) {
                    ••••••••
                  } @else {
                    {{ v.value }}
                  }
                </div>
                <button type="button" class="text-xs text-tf-green hover:underline" (click)="startEdit(v)">Edit</button>
                <button type="button" class="text-red-400 hover:underline" (click)="remove(v.id)">🗑</button>
              </div>
            }
          </div>
        }
      </div>
      }
      @if (openAdd) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" (click.self)="openAdd = false">
          <div class="w-full max-w-md rounded-xl border border-tf-border bg-tf-card p-6" (click)="$event.stopPropagation()">
            <h2 class="font-semibold">New variable</h2>
            <label class="mt-4 block text-xs text-tf-muted">Name</label>
            <input [(ngModel)]="form.name" class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm" />
            <label class="mt-3 block text-xs text-tf-muted">Type</label>
            <select [(ngModel)]="form.type" class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="secret">secret</option>
            </select>
            <label class="mt-3 block text-xs text-tf-muted">Value</label>
            <input [(ngModel)]="form.value" class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm" />
            <label class="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" [(ngModel)]="form.is_secret" /> Secret
            </label>
            <div class="mt-6 flex justify-end gap-2">
              <button type="button" class="rounded-lg px-4 py-2 text-sm" (click)="openAdd = false">Cancel</button>
              <button type="button" class="rounded-lg bg-tf-green px-4 py-2 text-sm font-medium text-black" (click)="add()">
                Save
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class VariablesPageComponent implements OnInit {
  private readonly ipc = inject(IpcService);
  private readonly toast = inject(ToastService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  protected readonly list = signal<VarRow[]>([]);
  protected readonly editingId = signal<string | null>(null);
  protected showSecrets = false;
  protected openAdd = false;
  protected form = { name: '', type: 'string', value: '', is_secret: false };
  protected editForm = { name: '', type: 'string', value: '', is_secret: false };

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const rows = (await this.ipc.api.variables.list()) as VarRow[];
    this.list.set(rows);
  }

  protected typeIcon(t: string): string {
    const m: Record<string, string> = { string: '📝', number: '#', boolean: '◆', secret: '🔒' };
    return m[t] ?? '📝';
  }

  startEdit(v: VarRow): void {
    this.editingId.set(v.id);
    this.editForm = {
      name: v.name,
      type: v.type,
      value: v.value,
      is_secret: !!v.is_secret || v.type === 'secret',
    };
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  async saveEdit(id: string): Promise<void> {
    await this.ipc.api.variables.update({
      id,
      name: this.editForm.name,
      type: this.editForm.type,
      value: this.editForm.value,
      is_secret: this.editForm.is_secret || this.editForm.type === 'secret',
    });
    this.editingId.set(null);
    await this.reload();
    this.toast.success('Variable updated');
  }

  async add(): Promise<void> {
    await this.ipc.api.variables.create({
      name: this.form.name,
      type: this.form.type,
      value: this.form.value,
      is_secret: this.form.is_secret || this.form.type === 'secret',
    });
    this.openAdd = false;
    this.form = { name: '', type: 'string', value: '', is_secret: false };
    await this.reload();
    this.toast.success('Variable created');
  }

  async remove(id: string): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: 'Delete variable',
      message: 'Remove this variable? Workflows referencing it may break.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await this.ipc.api.variables.delete(id);
    if (this.editingId() === id) this.editingId.set(null);
    await this.reload();
    this.toast.info('Variable deleted');
  }
}
