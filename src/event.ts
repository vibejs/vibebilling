export interface CheckoutSession {
  readonly id: string;
  readonly client_reference_id?: string | null;
  readonly customer?: string | null;
  readonly mode?: string;
  readonly payment_status?: string;
  readonly status?: string | null;
}

export interface SubscriptionObject {
  readonly id: string;
  readonly status?: string;
  readonly customer?: string | null;
}

export interface InvoiceObject {
  readonly id: string;
  readonly customer?: string | null;
  readonly subscription?: string | null;
}

/** Events the typed listener knows about. Other Stripe events stay available as raw objects. */
export interface BillingEventMap {
  "checkout.session.completed": CheckoutSession;
  "customer.subscription.updated": SubscriptionObject;
  "customer.subscription.deleted": SubscriptionObject;
  "invoice.paid": InvoiceObject;
}

export interface StripeEvent<TType extends string = string, TObject = Record<string, unknown>> {
  readonly id: string;
  readonly type: TType;
  readonly data: { readonly object: TObject };
}

export function isStripeEvent(value: unknown): value is StripeEvent {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const type = Reflect.get(value, "type");
  const data = Reflect.get(value, "data");
  if (typeof id !== "string" || id === "" || typeof type !== "string" || type === "") return false;
  if (typeof data !== "object" || data === null) return false;
  const object = Reflect.get(data, "object");
  return typeof object === "object" && object !== null;
}
