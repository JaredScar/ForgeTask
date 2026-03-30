import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly _active = signal<
    (ConfirmDialogOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  readonly active = this._active.asReadonly();

  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this._active.set({ ...options, resolve });
    });
  }

  respond(ok: boolean): void {
    const cur = this._active();
    if (cur) {
      cur.resolve(ok);
      this._active.set(null);
    }
  }
}
