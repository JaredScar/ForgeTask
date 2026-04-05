import { Injectable, signal } from '@angular/core';

/**
 * PLAN §21.3 — lightweight global busy flag for full-page / list loads.
 * Wrap async IPC work in `run()` so the shell can show a non-blocking indicator.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private depth = 0;
  readonly globalBusy = signal(false);

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++;
    this.globalBusy.set(true);
    try {
      return await fn();
    } finally {
      this.depth--;
      if (this.depth <= 0) {
        this.depth = 0;
        this.globalBusy.set(false);
      }
    }
  }
}
