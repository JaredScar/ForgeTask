import { isEntitlementRequiredError } from './entitlement-error';

describe('isEntitlementRequiredError', () => {
  it('returns true when code matches', () => {
    expect(isEntitlementRequiredError({ code: 'ENTITLEMENT_REQUIRED' })).toBeTrue();
  });

  it('returns true when message matches', () => {
    expect(isEntitlementRequiredError({ message: 'ENTITLEMENT_REQUIRED' })).toBeTrue();
  });

  it('returns false for non-entitlement errors', () => {
    expect(isEntitlementRequiredError({ code: 'OTHER_ERROR' })).toBeFalse();
    expect(isEntitlementRequiredError(null)).toBeFalse();
  });
});
