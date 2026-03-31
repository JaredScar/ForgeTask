import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IpcService } from '../services/ipc.service';
import { ToastService } from '../services/toast.service';

/** Blocks the Builder for Enterprise team members with the Viewer role. */
export const viewerBlockGuard: CanActivateFn = async () => {
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
  toast.warning('Viewers cannot edit workflows in the Builder.');
  await router.navigate(['/workflows']);
  return false;
};
