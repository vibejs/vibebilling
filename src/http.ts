import { HttpError } from "@usevibejs/server";
import { BILLING_SIGNATURE_INVALID, BillingError } from "./errors.ts";

/** Maps a signature failure to the route's declared HTTP error and lets every other error through. */
export function webhookError(error: unknown): never {
  if (error instanceof BillingError && error.code === BILLING_SIGNATURE_INVALID) {
    throw new HttpError(400, BILLING_SIGNATURE_INVALID, error.message, { cause: error });
  }
  throw error;
}
