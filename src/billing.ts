import { createCheckoutSession, type CheckoutInput } from "./checkout.ts";
import type { BillingEventMap, StripeEvent } from "./event.ts";
import { verifyStripeSignature } from "./signature.ts";

type Listener = (event: StripeEvent) => void | Promise<void>;

export interface BillingOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly fetch?: typeof fetch;
  readonly toleranceSec?: number;
}

/** Checkout sessions and typed Stripe event listeners. */
export class Billing {
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly toleranceSec: number | undefined;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(options: BillingOptions) {
    this.secretKey = options.secretKey;
    this.webhookSecret = options.webhookSecret;
    this.fetchImpl = options.fetch;
    this.toleranceSec = options.toleranceSec;
  }

  on<K extends keyof BillingEventMap>(
    type: K,
    listener: (event: StripeEvent<K, BillingEventMap[K]>) => void | Promise<void>,
  ): () => void;
  on(type: string, listener: (event: StripeEvent) => void | Promise<void>): () => void;
  on(type: string, listener: Listener): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
    return () => {
      set.delete(listener);
    };
  }

  createCheckoutSession(input: CheckoutInput): Promise<{ id: string; url: string }> {
    return createCheckoutSession({
      secretKey: this.secretKey,
      input,
      fetch: this.fetchImpl,
    });
  }

  verify(payload: string, header: string | null, now?: number): StripeEvent {
    return verifyStripeSignature({
      payload,
      header,
      secret: this.webhookSecret,
      toleranceSec: this.toleranceSec,
      now,
    });
  }

  async publish(event: StripeEvent): Promise<void> {
    const listeners = this.listeners.get(event.type);
    if (listeners === undefined) return;
    for (const listener of listeners) await listener(event);
  }
}
