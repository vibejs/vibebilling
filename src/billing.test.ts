import { createHmac } from "node:crypto";
import { defineContract, get } from "@usevibejs/contract";
import {
  Controller,
  Handle,
  HttpError,
  JsonLogger,
  Module,
  UseGuards,
  type RequestContext,
} from "@usevibejs/server";
import { VibeFactory } from "@usevibejs/server";
import * as v from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Billing } from "./billing.ts";
import { createCheckoutSession } from "./checkout.ts";
import {
  BILLING_CHECKOUT_FAILED,
  BILLING_ENTITLEMENT_REQUIRED,
  BILLING_INVALID_CHECKOUT,
  BILLING_INVALID_CONFIG,
  BILLING_SIGNATURE_INVALID,
  BillingError,
} from "./errors.ts";
import { isStripeEvent } from "./event.ts";
import { ENTITLEMENTS, RequireEntitlement, type EntitlementProvider } from "./guard.ts";
import { webhookError } from "./http.ts";
import { BILLING, BillingModule } from "./module.ts";
import { verifyStripeSignature } from "./signature.ts";

const SECRET = "whsec_test_secret";
const PAYLOAD =
  '{"id":"evt_test","object":"event","type":"checkout.session.completed","data":{"object":{"id":"cs_test","object":"checkout.session","client_reference_id":"org_1"}}}';
const TIMESTAMP = "1700000000";
const SIGNATURE = "ee3db092d7bf253829132b92289190b94923b87878564fac4c4824cbd0d0406b";

function signed(payload: string, timestamp = TIMESTAMP, secret = SECRET): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("verifyStripeSignature", () => {
  it("accepts the fixed vector and a second v1 during rotation", () => {
    expect(signed(PAYLOAD)).toBe(`t=${TIMESTAMP},v1=${SIGNATURE}`);
    const header = `bogus,=skip, =blank,t=,t=${TIMESTAMP},v1=abc, v1=${SIGNATURE}`;
    const event = verifyStripeSignature({
      payload: PAYLOAD,
      header,
      secret: SECRET,
      now: Number(TIMESTAMP),
      toleranceSec: 0,
    });
    expect(event.id).toBe("evt_test");
    expect(event.type).toBe("checkout.session.completed");
    expect(event.data.object).toMatchObject({ id: "cs_test", client_reference_id: "org_1" });
  });

  it("rejects a missing, expired, or mismatched signature", () => {
    expect(() => verifyStripeSignature({ payload: PAYLOAD, header: null, secret: "  " })).toThrow(
      expect.objectContaining({ code: BILLING_INVALID_CONFIG }),
    );
    const now = Number(TIMESTAMP);
    expect(() =>
      verifyStripeSignature({ payload: PAYLOAD, header: null, secret: SECRET, now }),
    ).toThrow(/missing/);
    expect(() =>
      verifyStripeSignature({ payload: PAYLOAD, header: "v1=abc", secret: SECRET, now }),
    ).toThrow(/missing/);
    expect(() =>
      verifyStripeSignature({ payload: PAYLOAD, header: "t=12a,v1=abc", secret: SECRET, now }),
    ).toThrow(/missing/);
    expect(() =>
      verifyStripeSignature({ payload: PAYLOAD, header: `t=${TIMESTAMP}`, secret: SECRET, now }),
    ).toThrow(/missing/);
    expect(() =>
      verifyStripeSignature({
        payload: PAYLOAD,
        header: `t=${TIMESTAMP},v1=abc`,
        secret: SECRET,
        now: now + 301,
      }),
    ).toThrow(/tolerance/);
    expect(() =>
      verifyStripeSignature({
        payload: PAYLOAD,
        header: signed(PAYLOAD),
        secret: SECRET,
        now: now + 300,
      }),
    ).not.toThrow();
    expect(() =>
      verifyStripeSignature({
        payload: PAYLOAD,
        header: `t=${TIMESTAMP},v1=${"0".repeat(64)}`,
        secret: SECRET,
        now,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      verifyStripeSignature({ payload: "{", header: signed("{"), secret: SECRET, now }),
    ).toThrow(expect.objectContaining({ code: BILLING_SIGNATURE_INVALID }));
    expect(() =>
      verifyStripeSignature({
        payload: '{"id":1}',
        header: signed('{"id":1}'),
        secret: SECRET,
        now,
      }),
    ).toThrow(/not an event/);
  });

  it("uses the clock and the default tolerance", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Number(TIMESTAMP) * 1000);
    expect(
      verifyStripeSignature({
        payload: PAYLOAD,
        header: `t=${TIMESTAMP},v1=${SIGNATURE}`,
        secret: SECRET,
      }).id,
    ).toBe("evt_test");
  });
});

describe("isStripeEvent", () => {
  const base = {
    id: "evt_test",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test" } },
  };

  it("requires an id, a type, and an object", () => {
    expect(isStripeEvent(base)).toBe(true);
    expect(isStripeEvent(1)).toBe(false);
    expect(isStripeEvent(null)).toBe(false);
    expect(isStripeEvent({ ...base, id: 1 })).toBe(false);
    expect(isStripeEvent({ ...base, id: "" })).toBe(false);
    expect(isStripeEvent({ ...base, type: 1 })).toBe(false);
    expect(isStripeEvent({ ...base, type: "" })).toBe(false);
    expect(isStripeEvent({ ...base, data: "nope" })).toBe(false);
    expect(isStripeEvent({ ...base, data: null })).toBe(false);
    expect(isStripeEvent({ ...base, data: { object: "nope" } })).toBe(false);
    expect(isStripeEvent({ ...base, data: { object: null } })).toBe(false);
  });
});

describe("createCheckoutSession", () => {
  const input = {
    price: "price_123",
    successUrl: "https://app.example/ok",
    cancelUrl: "https://app.example/no",
  };

  it("posts a checkout session and reads the url", async () => {
    const fetchImpl = vi.fn<
      (request: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (request, init) => {
      void request;
      void init;
      return Response.json({ id: "cs_1", url: "https://stripe.example/c" });
    });
    const session = await createCheckoutSession({
      secretKey: "sk_test",
      input: {
        ...input,
        mode: "subscription",
        quantity: 2,
        customerEmail: "a@example.com",
        clientReferenceId: "org_1",
      },
      fetch: fetchImpl,
      baseUrl: "https://stripe.test",
      apiVersion: "2024-06-20",
    });
    expect(session).toEqual({ id: "cs_1", url: "https://stripe.example/c" });
    const billing = new Billing({
      secretKey: "sk_test",
      webhookSecret: "whsec_test_secret",
      fetch: fetchImpl,
    });
    await expect(billing.createCheckoutSession(input)).resolves.toEqual({
      id: "cs_1",
      url: "https://stripe.example/c",
    });
    const params = new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][quantity]")).toBe("2");
    expect(params.get("customer_email")).toBe("a@example.com");
    expect(params.get("client_reference_id")).toBe("org_1");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ "stripe-version": "2024-06-20" });
  });

  it("uses Stripe defaults and rejects a bad session", async () => {
    const fetchImpl = vi.fn<
      (request: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (request, init) => {
      void request;
      void init;
      return Response.json({ id: "cs_1", url: "https://stripe.example/c" });
    });
    vi.stubGlobal("fetch", fetchImpl);
    await expect(createCheckoutSession({ secretKey: "sk_test", input })).resolves.toEqual({
      id: "cs_1",
      url: "https://stripe.example/c",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://api.stripe.com/v1/checkout/sessions",
    );
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body)).get("mode")).toBe(
      "payment",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      "stripe-version": "2024-11-20.acacia",
    });
    fetchImpl.mockResolvedValueOnce(new Response("no", { status: 402 }));
    await expect(createCheckoutSession({ secretKey: "sk_test", input })).rejects.toMatchObject({
      code: BILLING_CHECKOUT_FAILED,
    });
    for (const body of [
      null,
      "nope",
      { id: "" },
      { id: "cs" },
      { id: 1, url: "https://x" },
      { id: "cs", url: "" },
    ]) {
      fetchImpl.mockResolvedValueOnce(Response.json(body));
      await expect(createCheckoutSession({ secretKey: "sk_test", input })).rejects.toMatchObject({
        code: BILLING_CHECKOUT_FAILED,
      });
    }
    await expect(createCheckoutSession({ secretKey: "  ", input })).rejects.toMatchObject({
      code: BILLING_INVALID_CONFIG,
    });
    await expect(
      createCheckoutSession({ secretKey: "sk", input: { ...input, price: " " } }),
    ).rejects.toMatchObject({
      code: BILLING_INVALID_CHECKOUT,
    });
    await expect(
      createCheckoutSession({ secretKey: "sk", input: { ...input, successUrl: " " } }),
    ).rejects.toMatchObject({ code: BILLING_INVALID_CHECKOUT });
    await expect(
      createCheckoutSession({ secretKey: "sk", input: { ...input, cancelUrl: " " } }),
    ).rejects.toMatchObject({ code: BILLING_INVALID_CHECKOUT });
  });
});

describe("listeners and webhook", () => {
  it("delivers a typed event and ignores an unsubscribed listener", async () => {
    const billing = new Billing({ secretKey: "sk_test", webhookSecret: SECRET, toleranceSec: 0 });
    const seen: Array<string | null> = [];
    const stop = billing.on("checkout.session.completed", (event) => {
      seen.push(event.data.object.client_reference_id ?? null);
    });
    billing.on("checkout.session.completed", async (event) => {
      seen.push(event.data.object.id);
    });
    stop();
    await billing.publish(
      billing.verify(PAYLOAD, `t=${TIMESTAMP},v1=${SIGNATURE}`, Number(TIMESTAMP)),
    );
    expect(seen).toEqual(["cs_test"]);
    await billing.publish({
      id: "evt_other",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    });
    expect(seen).toEqual(["cs_test"]);
  });

  it("serves the webhook and maps a bad signature to 400", async () => {
    const billing = new Billing({ secretKey: "sk_test", webhookSecret: SECRET });
    @Module({ imports: [BillingModule.forRoot({ secretKey: "sk_test", webhookSecret: SECRET })] })
    class AppModule {}
    const app = await VibeFactory.create(AppModule, {
      logger: new JsonLogger({ level: "silent" }),
    });
    const refs: Array<string | null | undefined> = [];
    app.get(BILLING).on("checkout.session.completed", (event) => {
      refs.push(event.data.object.client_reference_id);
    });
    vi.useFakeTimers();
    vi.setSystemTime(Number(TIMESTAMP) * 1000);
    const ok = await app.request("/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${TIMESTAMP},v1=${SIGNATURE}` },
      body: PAYLOAD,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true });
    expect(refs).toEqual(["org_1"]);
    const bad = await app.request("/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=nope" },
      body: PAYLOAD,
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: BILLING_SIGNATURE_INVALID });
    await app.close();
    expect(billing).toBeInstanceOf(Billing);
    expect(() => BillingModule.forRoot({ secretKey: " ", webhookSecret: SECRET })).toThrow(
      expect.objectContaining({ code: BILLING_INVALID_CONFIG }),
    );
    expect(() => BillingModule.forRoot({ secretKey: "sk", webhookSecret: " " })).toThrow(
      expect.objectContaining({ code: BILLING_INVALID_CONFIG }),
    );
  });
});

describe("webhookError", () => {
  it("maps only the signature code", () => {
    expect(() => webhookError(new BillingError(BILLING_SIGNATURE_INVALID, "bad"))).toThrow(
      HttpError,
    );
    expect(() => webhookError(new BillingError(BILLING_INVALID_CONFIG, "bad"))).toThrow(
      BillingError,
    );
    expect(() => webhookError(new Error("boom"))).toThrow(/boom/);
  });
});

describe("RequireEntitlement", () => {
  const area = defineContract("/area", {
    get: get("/", {
      response: v.object({ ok: v.literal(true) }),
      errors: { [BILLING_ENTITLEMENT_REQUIRED]: 403 },
    }),
  });

  it("reads the application provider", async () => {
    class Plans implements EntitlementProvider {
      allows(entitlement: string, ctx: RequestContext): Promise<boolean> {
        return Promise.resolve(ctx.req.headers.get("x-plan") === entitlement);
      }
    }
    @Controller(area)
    @UseGuards(RequireEntitlement("pro"))
    class AreaController {
      @Handle(area.get)
      get(): { ok: true } {
        return { ok: true };
      }
    }
    @Module({
      controllers: [AreaController],
      providers: [Plans, { provide: ENTITLEMENTS, useExisting: Plans }],
      exports: [ENTITLEMENTS],
    })
    class AppModule {}
    const app = await VibeFactory.create(AppModule, {
      logger: new JsonLogger({ level: "silent" }),
    });
    expect((await app.request("/area", { headers: { "x-plan": "pro" } })).status).toBe(200);
    const denied = await app.request("/area", { headers: { "x-plan": "free" } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: BILLING_ENTITLEMENT_REQUIRED });
    await app.close();
    expect(() => RequireEntitlement("  ")).toThrow(
      expect.objectContaining({ code: BILLING_INVALID_CONFIG }),
    );
  });
});
