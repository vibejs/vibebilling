import {
  HttpError,
  inject,
  token,
  type CanActivate,
  type RequestContext,
  type Token,
} from "@usevibejs/server";
import { BILLING_ENTITLEMENT_REQUIRED, BILLING_INVALID_CONFIG, BillingError } from "./errors.ts";

/**
 * The application supplies this. Billing does not decide who is entitled.
 * `allows` returns whether the request may use `entitlement`.
 */
export interface EntitlementProvider {
  allows(entitlement: string, ctx: RequestContext): boolean | Promise<boolean>;
}

/** Inject the application's entitlement source. */
export const ENTITLEMENTS: Token<EntitlementProvider> = token<EntitlementProvider>("ENTITLEMENTS");

/** A guard that reads `ENTITLEMENTS`. It does not talk to Stripe and it is not an auth guard. */
export function RequireEntitlement(entitlement: string): new () => CanActivate {
  if (entitlement.trim() === "") {
    throw new BillingError(BILLING_INVALID_CONFIG, "Entitlement name is required.");
  }
  class EntitlementGuard implements CanActivate {
    private readonly provider = inject(ENTITLEMENTS);

    async canActivate(ctx: RequestContext): Promise<boolean> {
      if (!(await this.provider.allows(entitlement, ctx))) {
        throw new HttpError(
          403,
          BILLING_ENTITLEMENT_REQUIRED,
          `Missing entitlement ${entitlement}.`,
        );
      }
      return true;
    }
  }
  return EntitlementGuard;
}
