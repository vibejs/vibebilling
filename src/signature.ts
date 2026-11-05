import { createHmac, timingSafeEqual } from "node:crypto";
import { BILLING_INVALID_CONFIG, BILLING_SIGNATURE_INVALID, BillingError } from "./errors.ts";
import { isStripeEvent, type StripeEvent } from "./event.ts";

export interface SignatureInput {
  readonly payload: string;
  readonly header: string | null;
  readonly secret: string;
  readonly toleranceSec?: number;
  /** Unix seconds. Defaults to the current time. */
  readonly now?: number;
}

/** Checks a Stripe `Stripe-Signature` header and returns the event. No live API call. */
export function verifyStripeSignature(input: SignatureInput): StripeEvent {
  if (input.secret.trim() === "") {
    throw new BillingError(BILLING_INVALID_CONFIG, "Webhook secret is required.");
  }
  const parts = headerParts(input.header ?? "");
  const timestamp = parts.get("t")?.[0];
  const signatures = parts.get("v1") ?? [];
  if (timestamp === undefined || !/^\d+$/.test(timestamp) || signatures.length === 0) {
    throw new BillingError(BILLING_SIGNATURE_INVALID, "Stripe signature is missing.");
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSec ?? 300;
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    throw new BillingError(
      BILLING_SIGNATURE_INVALID,
      "Stripe signature is outside the tolerance window.",
    );
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest("hex");
  if (!signatures.some((signature) => safeEqual(signature, expected))) {
    throw new BillingError(BILLING_SIGNATURE_INVALID, "Stripe signature does not match.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.payload);
  } catch (error) {
    throw new BillingError(BILLING_SIGNATURE_INVALID, "Stripe event payload is not JSON.", {
      cause: error,
    });
  }
  if (!isStripeEvent(parsed)) {
    throw new BillingError(BILLING_SIGNATURE_INVALID, "Stripe event payload is not an event.");
  }
  return parsed;
}

function headerParts(header: string): Map<string, string[]> {
  const parts = new Map<string, string[]>();
  for (const item of header.split(",")) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (key === "" || value === "") continue;
    const list = parts.get(key) ?? [];
    list.push(value);
    parts.set(key, list);
  }
  return parts;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
