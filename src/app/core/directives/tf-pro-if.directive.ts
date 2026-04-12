import { Directive, Input, OnInit, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import { IpcService } from '../services/ipc.service';

/**
 * Renders the host template when Pro/Enterprise entitlement is unlocked.
 * Optionally renders an else template when not unlocked.
 *
 * Usage:
 *   <div *tfProIf>Pro content</div>
 *   <ng-template #gate><p>Pro required</p></ng-template>
 *   <div *tfProIf="gate">Pro content</div>
 */
@Directive({
  selector: '[tfProIf]',
  standalone: true,
})
export class TfProIfDirective implements OnInit {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly ipc = inject(IpcService);

  @Input('tfProIf') elseTpl: TemplateRef<unknown> | null = null;

  ngOnInit(): void {
    void this.renderIfEligible();
  }

  private async renderIfEligible(): Promise<void> {
    if (!this.ipc.isElectron) {
      this.vcr.createEmbeddedView(this.tpl);
      return;
    }
    try {
      const { unlocked } = await this.ipc.api.entitlement.getStatus();
      if (unlocked) {
        this.vcr.createEmbeddedView(this.tpl);
      } else if (this.elseTpl) {
        this.vcr.createEmbeddedView(this.elseTpl);
      }
    } catch {
      if (this.elseTpl) {
        this.vcr.createEmbeddedView(this.elseTpl);
      }
    }
  }
}
