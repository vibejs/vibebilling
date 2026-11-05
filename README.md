# Vibe Billing

**Stripe Checkout sessions, signed webhooks, and entitlement guards for vibe.js.**

The package name is `@usevibejs/billing`.

## Install

```bash
pnpm add @usevibejs/billing @usevibejs/server @usevibejs/contract
```

## Quick start

`BillingModule.forRoot` creates Checkout sessions and verifies Stripe webhooks. Listeners are typed by event name. `RequireEntitlement` reads the application's `ENTITLEMENTS` provider. It does not grant access by itself and it is not an auth guard.

```ts
import { BillingModule, RequireEntitlement, ENTITLEMENTS } from "@usevibejs/billing";

BillingModule.forRoot({ secretKey, webhookSecret });
RequireEntitlement("pro");
```

Unit tests verify a fixed HMAC vector. They do not use a live Stripe key.

## Error codes

See [docs/errors.md](docs/errors.md).

## Local development

```bash
pnpm install
pnpm check
```

`pnpm check` formats, lints, typechecks, and runs tests at 100% per-file coverage.

## Releases

Releases use changesets. A maintainer runs the Release workflow from main. Do not publish by hand.

## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
