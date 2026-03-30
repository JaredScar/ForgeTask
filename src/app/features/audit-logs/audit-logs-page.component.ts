import { Component, OnInit, inject, signal } from '@angular/core';
import { IpcService } from '../../core/services/ipc.service';

interface AuditRow {
  id: string;
  user_id: string;
  action: string;
  resource: string;
  ip: string;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-audit-logs-page',
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold">Audit Logs</h1>
          <p class="mt-1 text-sm text-tf-muted">Security and compliance event tracking</p>
        </div>
        <button type="button" (click)="exportCsv()" class="rounded-lg border border-tf-border px-4 py-2 text-sm hover:bg-neutral-800">
          Export CSV
        </button>
      </div>
      <div class="mt-4 overflow-hidden rounded-xl border border-tf-border">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-tf-border bg-tf-card text-xs text-tf-muted">
            <tr>
              <th class="p-3">Time</th>
              <th class="p-3">User</th>
              <th class="p-3">Action</th>
              <th class="p-3">Resource</th>
              <th class="p-3">IP</th>
              <th class="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr class="border-b border-tf-border/60">
                <td class="p-3 font-mono text-xs">{{ timeOnly(r.created_at) }}</td>
                <td class="p-3 text-xs">{{ r.user_id }}</td>
                <td class="p-3">
                  <span class="rounded bg-neutral-800 px-2 py-0.5 text-[10px]">{{ r.action }}</span>
                </td>
                <td class="p-3 text-xs">{{ r.resource }}</td>
                <td class="p-3 font-mono text-xs text-tf-muted">{{ r.ip }}</td>
                <td class="p-3">
                  <span class="rounded-full bg-tf-green/20 px-2 py-0.5 text-[10px] text-tf-green">{{ r.status }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class AuditLogsPageComponent implements OnInit {
  private readonly ipc = inject(IpcService);
  protected readonly rows = signal<AuditRow[]>([]);

  async ngOnInit(): Promise<void> {
    const list = (await this.ipc.api.audit.list()) as Record<string, unknown>[];
    this.rows.set(
      list.map((x) => ({
        id: String(x['id']),
        user_id: String(x['user_id']),
        action: String(x['action']),
        resource: String(x['resource']),
        ip: String(x['ip']),
        status: String(x['status']),
        created_at: String(x['created_at']),
      }))
    );
  }

  protected timeOnly(iso: string): string {
    return iso.length >= 19 ? iso.slice(11, 19) : iso;
  }

  async exportCsv(): Promise<void> {
    const path = await this.ipc.api.audit.export();
    if (path) alert('Exported to ' + path);
  }
}
