import { describe, expect, it } from 'vitest';
import { isEntitlementRequiredError } from './entitlement-error';

describe('isEntitlementRequiredError', () => {
  it('returns true when code matches', () => {
    expect(isEntitlementRequiredError({ code: 'ENTITLEMENT_REQUIRED' })).toBe(true);
  });

  it('returns true when message matches', () => {
    expect(isEntitlementRequiredError({ message: 'ENTITLEMENT_REQUIRED' })).toBe(true);
  });

  it('returns false for non-entitlement errors', () => {
    expect(isEntitlementRequiredError({ code: 'OTHER_ERROR' })).toBe(false);
    expect(isEntitlementRequiredError(null)).toBe(false);
  });
});
