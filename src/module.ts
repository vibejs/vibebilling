// oxlint-disable typescript/no-extraneous-class -- module classes are containers
import {
  Controller,
  Handle,
  Module,
  inject,
  token,
  type Ctx,
  type DynamicModule,
  type Token,
} from "@usevibejs/server";
import { Billing, type BillingOptions } from "./billing.ts";
import { billingWebhook } from "./contract.ts";
import { BILLING_INVALID_CONFIG, BillingError } from "./errors.ts";
import type { StripeEvent } from "./event.ts";
import { webhookError } from "./http.ts";

/** Inject this for Checkout and webhook listeners. */
export const BILLING: Token<Billing> = token<Billing>("BILLING");

@Controller(billingWebhook)
class WebhookController {
  private readonly billing = inject(BILLING);

  @Handle(billingWebhook.receive)
  async receive(ctx: Ctx<typeof billingWebhook.receive>): Promise<{ received: true }> {
    const payload = await ctx.req.text();
    let event: StripeEvent;
    try {
      event = this.billing.verify(payload, ctx.req.headers.get("stripe-signature"));
    } catch (error) {
      webhookError(error);
    }
    await this.billing.publish(event);
    return { received: true };
  }
}

/** Provides `Billing` and `POST /billing/webhook`. Entitlements come from the application. */
@Module({})
export class BillingModule {
  static forRoot(options: BillingOptions): DynamicModule {
    if (options.secretKey.trim() === "" || options.webhookSecret.trim() === "") {
      throw new BillingError(
        BILLING_INVALID_CONFIG,
        "Stripe secret key and webhook secret are required.",
      );
    }
    return {
      module: BillingModule,
      global: true,
      controllers: [WebhookController],
      providers: [{ provide: BILLING, useValue: new Billing(options) }],
      exports: [BILLING],
    };
  }
}
