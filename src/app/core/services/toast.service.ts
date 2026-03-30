import { Injectable, signal } from '@angular/core';

export type ToastLevel = 'success' | 'error' | 'info' | 'warning';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _items = signal<Array<{ id: string; message: string; level: ToastLevel }>>([]);
  readonly items = this._items.asReadonly();

  show(message: string, level: ToastLevel = 'info'): void {
    const id = crypto.randomUUID();
    this._items.update((a) => [...a, { id, message, level }]);
    setTimeout(() => this.dismiss(id), 4000);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error');
  }

  info(message: string): void {
    this.show(message, 'info');
  }

  warning(message: string): void {
    this.show(message, 'warning');
  }

  dismiss(id: string): void {
    this._items.update((a) => a.filter((t) => t.id !== id));
  }
}
