import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { ActivatedRouteSnapshot } from '@angular/router';
import { IpcService } from '../services/ipc.service';
import { ToastService } from '../services/toast.service';

/** Blocks edit surfaces (Builder, Variables, …) for team members with the Viewer role. */
export const viewerBlockGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const ipc = inject(IpcService);
  const router = inject(Router);
  const toast = inject(ToastService);
  if (!ipc.isElectron) return true;
  let unlocked = false;
  try {
    const st = await ipc.api.entitlement.getStatus();
    unlocked = st.unlocked;
  } catch {
    return true;
  }
  if (!unlocked) return true;
  try {
    const team = (await ipc.api.team.list()) as Array<{ is_self?: number; role?: string }>;
    const self = team.find((m) => m.is_self === 1);
    if (self?.role !== 'Viewer') return true;
  } catch {
    return true;
  }
  const msg =
    (route.data['viewerBlockMessage'] as string | undefined) ?? 'Viewers cannot edit workflows in the Builder.';
  const redirect = (route.data['viewerRedirect'] as string[] | undefined) ?? ['/workflows'];
  toast.warning(msg);
  await router.navigate(redirect);
  return false;
};
