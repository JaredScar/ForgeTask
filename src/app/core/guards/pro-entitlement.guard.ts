import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IpcService } from '../services/ipc.service';

/** Blocks Pro / Enterprise routes until a valid entitlement key is on file (see Settings). */
export const proEntitlementGuard: CanActivateFn = async () => {
  const ipc = inject(IpcService);
  const router = inject(Router);
  try {
    const { unlocked } = await ipc.api.entitlement.getStatus();
    if (unlocked) return true;
  } catch {
    /* treat as locked */
  }
  return router.createUrlTree(['/settings'], { queryParams: { unlock: '1' } });
};
