import { Component, OnInit, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { IpcService } from '../../core/services/ipc.service';

type TrendChip = { label: string; trend: 'up' | 'down' | 'flat'; favorable: boolean };

type Summary = {
  totalRuns: number;
  successRate: number;
  avgDurationSec: number;
  activeWorkflows: number;
  trends: {
    totalRuns: TrendChip;
    successRate: TrendChip;
    avgDurationSec: TrendChip;
    activeWorkflows: TrendChip;
  };
};

@Component({
  selector: 'app-analytics-page',
  imports: [NgClass],
  template: `
    <div>
      <h1 class="text-xl font-semibold">Analytics Dashboard</h1>
      <p class="mt-1 text-sm text-tf-muted">Monitor workflow performance and usage</p>
      <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-xl border border-tf-border bg-tf-card p-4">
          <p class="text-xs text-tf-muted">Total Runs</p>
          <p class="mt-1 text-2xl font-bold">{{ summary()?.totalRuns ?? 0 }}</p>
          @if (summary(); as s) {
            <p class="mt-1 text-xs" [ngClass]="trendClass(s.trends.totalRuns)">{{ s.trends.totalRuns.label }}</p>
          }
        </div>
        <div class="rounded-xl border border-tf-border bg-tf-card p-4">
          <p class="text-xs text-tf-muted">Success Rate</p>
          <p class="mt-1 text-2xl font-bold">{{ summary()?.successRate ?? 0 }}%</p>
          @if (summary(); as s) {
            <p class="mt-1 text-xs" [ngClass]="trendClass(s.trends.successRate)">{{ s.trends.successRate.label }}</p>
          }
        </div>
        <div class="rounded-xl border border-tf-border bg-tf-card p-4">
          <p class="text-xs text-tf-muted">Avg Duration</p>
          <p class="mt-1 text-2xl font-bold">{{ summary()?.avgDurationSec ?? 0 }}s</p>
          @if (summary(); as s) {
            <p class="mt-1 text-xs" [ngClass]="trendClass(s.trends.avgDurationSec)">{{ s.trends.avgDurationSec.label }}</p>
          }
        </div>
        <div class="rounded-xl border border-tf-border bg-tf-card p-4">
          <p class="text-xs text-tf-muted">Active Workflows</p>
          <p class="mt-1 text-2xl font-bold">{{ summary()?.activeWorkflows ?? 0 }}</p>
          @if (summary(); as s) {
            <p class="mt-1 text-xs" [ngClass]="trendClass(s.trends.activeWorkflows)">{{ s.trends.activeWorkflows.label }}</p>
          }
        </div>
      </div>
      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <div class="rounded-xl border border-tf-border bg-tf-card p-4">
          <h2 class="text-sm font-medium">Runs by Workflow (7 days)</h2>
          <div class="mt-4 space-y-3">
            @for (w of runs(); track w.id) {
              <div>
                <div class="flex justify-between text-xs">
                  <span>{{ w.name }}</span>
                  <span class="text-tf-muted">{{ w.run_count }}</span>
                </div>
                <div class="mt-1 h-2 overflow-hidden rounded-full bg-neutral-800">
                  <div class="h-full rounded-full bg-tf-green" [style.width.%]="barWidth(w.run_count)"></div>
                </div>
              </div>
            }
          </div>
        </div>
        <div class="rounded-xl border border-tf-border bg-tf-card p-4">
          <h2 class="text-sm font-medium">System Health</h2>
          <div class="mt-4 space-y-3">
            @for (m of healthRows(); track m.label) {
              <div>
                <div class="flex justify-between text-xs">
                  <span>{{ m.label }}</span>
                  <span>{{ m.pct }}%</span>
                </div>
                <div class="mt-1 h-2 overflow-hidden rounded-full bg-neutral-800">
                  <div class="h-full rounded-full bg-tf-green" [style.width.%]="m.pct"></div>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AnalyticsPageComponent implements OnInit {
  private readonly ipc = inject(IpcService);
  protected readonly summary = signal<Summary | null>(null);
  protected readonly runs = signal<Array<{ id: string; name: string; run_count: number }>>([]);
  protected readonly health = signal({ cpu: 0, memory: 0, queue: 0, storageGb: 0 });
  private maxRuns = 1;

  protected trendClass(t: TrendChip): Record<string, boolean> {
    if (t.trend === 'flat') return { 'text-tf-muted': true };
    return t.favorable ? { 'text-tf-green': true } : { 'text-red-400': true };
  }

  protected healthRows() {
    const h = this.health();
    return [
      { label: 'CPU Usage', pct: Math.min(100, h.cpu) },
      { label: 'Memory', pct: Math.min(100, h.memory) },
      { label: 'Queue Capacity', pct: Math.min(100, h.queue) },
      { label: 'Storage', pct: Math.min(100, h.storageGb * 2) },
    ];
  }

  protected barWidth(count: number): number {
    const m = this.maxRuns || 1;
    return Math.min(100, (count / m) * 100);
  }

  async ngOnInit(): Promise<void> {
    const s = (await this.ipc.api.analytics.getSummary()) as Summary;
    this.summary.set(s);
    const r = await this.ipc.api.analytics.getRunsByWorkflow();
    this.runs.set(r);
    this.maxRuns = Math.max(1, ...r.map((x) => x.run_count));
    const sys = await this.ipc.api.analytics.getSystemHealth();
    this.health.set(sys);
  }
}
