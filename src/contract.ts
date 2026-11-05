import { defineContract, post } from "@usevibejs/contract";
import * as v from "valibot";
import { BILLING_SIGNATURE_INVALID } from "./errors.ts";

/** `POST /billing/webhook` reads the raw body. The route has no JSON schema so the signature bytes stay intact. */
export const billingWebhook = defineContract("/billing/webhook", {
  receive: post("/", {
    response: v.object({ received: v.literal(true) }),
    errors: { [BILLING_SIGNATURE_INVALID]: 400 },
  }),
});
