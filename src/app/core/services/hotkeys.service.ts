import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Global shortcuts from shell; feature pages subscribe (e.g. builder save). PLAN §21.5 */
@Injectable({ providedIn: 'root' })
export class HotkeysService {
  /** Ctrl+S while on builder */
  readonly saveBuilder$ = new Subject<void>();
  /** Ctrl+R while on builder */
  readonly testRunBuilder$ = new Subject<void>();
}
