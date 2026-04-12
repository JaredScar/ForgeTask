import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../core/services/ipc.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { LoadingService } from '../../core/services/loading.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';

type MemberRow = Record<string, unknown> & {
  id: string;
  email: string;
  display_name: string;
  role: string;
  last_active: string | null;
  workflow_count: number;
  is_self: number;
};

@Component({
  selector: 'app-team-page',
  imports: [FormsModule, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold">Team Management</h1>
          <p class="mt-1 text-sm text-tf-muted">Manage team members and permissions (local roster)</p>
          @if (entitlementSeats() != null) {
            <p class="mt-2 text-xs text-tf-muted">Licensed seats (from organization key payload): {{ entitlementSeats() }}</p>
          }
        </div>
        @if (!isViewer()) {
          <button
            type="button"
            (click)="inviteOpen.set(true)"
            class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
          >
            + Invite Member
          </button>
        }
      </div>
      <div class="mt-6 space-y-3">
        @if (members().length === 0) {
          <app-empty-state
            icon="👥"
            title="No team members yet"
            description="Invite colleagues to collaborate on automations. Members are stored locally on this device."
          />
        } @else {
          @for (m of members(); track m.id) {
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tf-border bg-tf-card p-4">
              <div class="flex items-center gap-3">
                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-tf-green/20 text-sm font-semibold text-tf-green">
                  {{ initials(m.display_name) }}
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-neutral-100">{{ m.display_name }}</span>
                    @if (m.is_self) {
                      <span class="rounded bg-tf-green/15 px-1.5 py-0.5 text-[10px] font-medium text-tf-green">You</span>
                    }
                  </div>
                  <div class="text-xs text-tf-muted">{{ m.email }}</div>
                  <div class="mt-1 text-xs text-neutral-500">
                    Last active: {{ m.last_active ?? '—' }} · {{ m.workflow_count }} workflow(s)
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="rounded-full border border-tf-border px-3 py-1 text-xs text-neutral-300">{{ m.role }}</span>
                @if (!m.is_self) {
                  <button type="button" class="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10" (click)="removeMember(m)">Remove</button>
                }
              </div>
            </div>
          }
          @if (members().length === 1 && members()[0].is_self) {
            <p class="px-1 text-xs text-tf-muted">
              Only you so far — use <strong class="text-neutral-400">+ Invite Member</strong> to add colleagues.
            </p>
          }
        }
      </div>
      @if (inviteOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" (click.self)="inviteOpen.set(false)">
          <div class="w-full max-w-md rounded-xl border border-tf-border bg-tf-card p-6" (click)="$event.stopPropagation()">
            <h2 class="font-semibold">Invite member</h2>
            <p class="mt-1 text-xs text-tf-muted">Adds a person to this device’s team list (no email is sent).</p>
            <label class="mt-4 block text-xs text-tf-muted">Display name</label>
            <input [(ngModel)]="inviteForm.display_name" class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm" />
            <label class="mt-3 block text-xs text-tf-muted">Email</label>
            <input [(ngModel)]="inviteForm.email" type="email" class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm" />
            <label class="mt-3 block text-xs text-tf-muted">Role</label>
            <select [(ngModel)]="inviteForm.role" class="mt-1 w-full rounded-lg border border-tf-border bg-tf-bg px-3 py-2 text-sm">
              <option value="Admin">Admin</option>
              <option value="Editor">Editor</option>
              <option value="Viewer">Viewer</option>
            </select>
            <div class="mt-6 flex justify-end gap-2">
              <button type="button" class="rounded-lg px-4 py-2 text-sm" (click)="inviteOpen.set(false)">Cancel</button>
              <button type="button" class="rounded-lg bg-tf-green px-4 py-2 text-sm font-medium text-black" (click)="submitInvite()">
                Add member
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class TeamPageComponent implements OnInit {
  private readonly ipc = inject(IpcService);
  private readonly toast = inject(ToastService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly loading = inject(LoadingService);

  protected readonly members = signal<MemberRow[]>([]);
  protected readonly inviteOpen = signal(false);
  protected readonly isViewer = signal(false);
  protected readonly entitlementSeats = signal<number | null>(null);
  protected inviteForm = { display_name: '', email: '', role: 'Editor' };

  async ngOnInit(): Promise<void> {
    await this.loading.run(() => this.reload());
    try {
      const st = await this.ipc.api.entitlement.getStatus();
      this.entitlementSeats.set(st.seats ?? null);
    } catch {
      this.entitlementSeats.set(null);
    }
  }

  private async reload(): Promise<void> {
    const rows = (await this.ipc.api.team.list()) as MemberRow[];
    this.members.set(rows);
    const self = rows.find((m) => m.is_self === 1);
    this.isViewer.set(self?.role === 'Viewer');
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  async submitInvite(): Promise<void> {
    if (this.isViewer()) {
      this.toast.warning('Viewers cannot invite team members.');
      return;
    }
    const { display_name, email, role } = this.inviteForm;
    if (!display_name.trim() || !email.trim()) {
      this.toast.warning('Name and email are required');
      return;
    }
    await this.ipc.api.team.invite({ display_name: display_name.trim(), email: email.trim(), role });
    this.inviteOpen.set(false);
    this.inviteForm = { display_name: '', email: '', role: 'Editor' };
    await this.reload();
    this.toast.success('Member added');
  }

  async removeMember(m: MemberRow): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: 'Remove member',
      message: `Remove ${m.display_name} from the team list?`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await this.ipc.api.team.remove(m.id);
    await this.reload();
    this.toast.info('Member removed');
  }
}
