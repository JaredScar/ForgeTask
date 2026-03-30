export function isEntitlementRequiredError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'message' in e && (e as { message: string }).message === 'ENTITLEMENT_REQUIRED';
}
