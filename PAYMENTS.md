# Payments

## Payments

Business configuration:

- Deposit: 50%
- PIX expiration: 15 minutes
- Cash: enabled
- Provider: Mercado Pago

### Supabase Edge Function secrets

Never commit the values below:

```text
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_PUBLIC_KEY
```

`MERCADO_PAGO_WEBHOOK_SECRET` is recommended when Mercado Pago exposes the
plain webhook signature value. Without it, the webhook still validates the
notification by fetching the authoritative payment from Mercado Pago and
matching its external reference to an internal payment.

`MERCADO_PAGO_PUBLIC_KEY` is the production public key used by the browser SDK
to tokenize card data. The access token must stay only in Supabase secrets.

### Deploy

```powershell
npx --yes supabase@latest login
npx --yes supabase@latest link --project-ref ujidqagyllheibmuuboy
npx --yes supabase@latest secrets set MERCADO_PAGO_ACCESS_TOKEN=...
npx --yes supabase@latest secrets set MERCADO_PAGO_PUBLIC_KEY=...
npx --yes supabase@latest functions deploy create-booking-payment --no-verify-jwt
npx --yes supabase@latest functions deploy get-booking-payment-options --no-verify-jwt
npx --yes supabase@latest functions deploy mercado-pago-webhook --no-verify-jwt
```

Both functions implement their own authentication:

- `create-booking-payment` validates the client's Supabase JWT.
- `get-booking-payment-options` validates the client's Supabase JWT and returns
  the current deposit/card eligibility rules.
- `mercado-pago-webhook` validates Mercado Pago's `x-signature` HMAC when the
  signature secret is available, then fetches the authoritative provider payment.

### Mercado Pago webhook

Configure payment notifications for:

```text
https://ujidqagyllheibmuuboy.supabase.co/functions/v1/mercado-pago-webhook
```

When available, the webhook secret configured in Mercado Pago must match
`MERCADO_PAGO_WEBHOOK_SECRET` in Supabase.
