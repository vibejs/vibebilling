/** Stable codes owned by `@usevibejs/billing`. They are not vibe.js `VIBE` codes. */
export const BILLING_INVALID_CONFIG = "BILLING_INVALID_CONFIG";
export const BILLING_INVALID_CHECKOUT = "BILLING_INVALID_CHECKOUT";
export const BILLING_CHECKOUT_FAILED = "BILLING_CHECKOUT_FAILED";
export const BILLING_SIGNATURE_INVALID = "BILLING_SIGNATURE_INVALID";
export const BILLING_ENTITLEMENT_REQUIRED = "BILLING_ENTITLEMENT_REQUIRED";

/** A billing error. `code` is stable. */
export class BillingError extends Error {
  override readonly name = "BillingError";
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}
