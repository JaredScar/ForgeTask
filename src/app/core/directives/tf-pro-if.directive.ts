import { Directive, OnInit, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import { IpcService } from '../services/ipc.service';

/** Renders the template when Pro/Enterprise entitlement is unlocked (browser preview: always show). */
@Directive({
  selector: '[tfProIf]',
  standalone: true,
})
export class TfProIfDirective implements OnInit {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly ipc = inject(IpcService);

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
      if (unlocked) this.vcr.createEmbeddedView(this.tpl);
    } catch {
      /* no view */
    }
  }
}
