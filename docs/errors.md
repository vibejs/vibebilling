# Error codes

These codes belong to `@usevibejs/billing`. The `VIBE` series belongs to the vibe.js monorepo and is not used here.

| Code                           | Meaning                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `BILLING_INVALID_CONFIG`       | Thrown when a Stripe secret, webhook secret, or entitlement name is missing. |
| `BILLING_INVALID_CHECKOUT`     | Thrown when price, success URL, or cancel URL is missing.                    |
| `BILLING_CHECKOUT_FAILED`      | Thrown when Stripe rejects the session or returns no id and url.             |
| `BILLING_SIGNATURE_INVALID`    | HTTP 400 when the webhook signature, timestamp, or payload is not valid.     |
| `BILLING_ENTITLEMENT_REQUIRED` | HTTP 403 when the application provider denies the entitlement.               |
