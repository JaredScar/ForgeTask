export function isEntitlementRequiredError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = 'code' in e ? String((e as { code?: string }).code) : '';
  const msg = 'message' in e ? String((e as { message?: string }).message) : '';
  return code === 'ENTITLEMENT_REQUIRED' || msg === 'ENTITLEMENT_REQUIRED';
}
