import {
  BILLING_CHECKOUT_FAILED,
  BILLING_INVALID_CHECKOUT,
  BILLING_INVALID_CONFIG,
  BillingError,
} from "./errors.ts";

export interface CheckoutInput {
  readonly price: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly quantity?: number;
  readonly mode?: "payment" | "subscription";
  readonly customerEmail?: string;
  readonly clientReferenceId?: string;
}

export interface CheckoutClient {
  readonly secretKey: string;
  readonly input: CheckoutInput;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly apiVersion?: string;
}

const DEFAULT_VERSION = "2024-11-20.acacia";

/** Creates a Stripe Checkout Session. Tests pass `fetch`; there is no live key in the package. */
export async function createCheckoutSession(
  options: CheckoutClient,
): Promise<{ id: string; url: string }> {
  if (options.secretKey.trim() === "") {
    throw new BillingError(BILLING_INVALID_CONFIG, "Stripe secret key is required.");
  }
  const { input } = options;
  if (input.price.trim() === "") {
    throw new BillingError(BILLING_INVALID_CHECKOUT, "Checkout needs a price.");
  }
  if (input.successUrl.trim() === "") {
    throw new BillingError(BILLING_INVALID_CHECKOUT, "Checkout needs a success URL.");
  }
  if (input.cancelUrl.trim() === "") {
    throw new BillingError(BILLING_INVALID_CHECKOUT, "Checkout needs a cancel URL.");
  }
  const body = new URLSearchParams();
  body.set("mode", input.mode ?? "payment");
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("line_items[0][price]", input.price);
  body.set("line_items[0][quantity]", String(input.quantity ?? 1));
  if (input.customerEmail !== undefined) body.set("customer_email", input.customerEmail);
  if (input.clientReferenceId !== undefined)
    body.set("client_reference_id", input.clientReferenceId);
  const response = await (options.fetch ?? fetch)(
    `${options.baseUrl ?? "https://api.stripe.com"}/v1/checkout/sessions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": options.apiVersion ?? DEFAULT_VERSION,
      },
      body,
    },
  );
  if (!response.ok) {
    throw new BillingError(BILLING_CHECKOUT_FAILED, `Stripe checkout failed (${response.status}).`);
  }
  const session = readSession(await response.json());
  if (session === undefined) {
    throw new BillingError(BILLING_CHECKOUT_FAILED, "Stripe checkout returned no session.");
  }
  return session;
}

function readSession(value: unknown): { id: string; url: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const id = Reflect.get(value, "id");
  const url = Reflect.get(value, "url");
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof url !== "string" || url === "") return undefined;
  return { id, url };
}
