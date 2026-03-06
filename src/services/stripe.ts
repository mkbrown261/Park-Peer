// ─── Stripe Service ──────────────────────────────────────────────────────────
// Uses Stripe REST API directly (no SDK) — Cloudflare Workers compatible
// All calls are server-side only. Keys never reach the browser.

const STRIPE_API = 'https://api.stripe.com/v1'

type Env = {
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  DB: D1Database
}

// ── Helper: call Stripe REST API ─────────────────────────────────────────────
async function stripeRequest(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, string | number | boolean>,
  idempotencyKey?: string
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-06-20'
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey
  }

  const options: RequestInit = { method, headers }
  if (body) {
    options.body = new URLSearchParams(body as Record<string, string>).toString()
  }

  const res = await fetch(`${STRIPE_API}${path}`, options)
  const data = await res.json() as any
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe error ${res.status}`)
  }
  return data
}

// ── Create Payment Intent ────────────────────────────────────────────────────
export async function createPaymentIntent(
  env: Env,
  amountCents: number,
  currency: string = 'usd',
  metadata: Record<string, string> = {},
  idempotencyKey?: string   // checkout_token passed by caller to prevent duplicate PIs
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const flatMeta: Record<string, string> = {}
  for (const [k, v] of Object.entries(metadata)) {
    flatMeta[`metadata[${k}]`] = String(v)
  }

  const pi = await stripeRequest(env, 'POST', '/payment_intents', {
    amount: amountCents,
    currency,
    // Stripe form-encoding: automatic_payment_methods[enabled]=true
    'automatic_payment_methods[enabled]': 'true',
    ...flatMeta
  } as any, idempotencyKey ? `pi-${idempotencyKey}` : undefined)

  return { clientSecret: pi.client_secret, paymentIntentId: pi.id }
}

// ── Create Stripe Customer ───────────────────────────────────────────────────
export async function createCustomer(
  env: Env,
  email: string,
  name: string
): Promise<string> {
  const customer = await stripeRequest(env, 'POST', '/customers', {
    email,
    name,
    'metadata[platform]': 'parkpeer'
  } as any)
  return customer.id
}

// ── Retrieve Payment Intent ──────────────────────────────────────────────────
export async function getPaymentIntent(env: Env, piId: string): Promise<any> {
  return stripeRequest(env, 'GET', `/payment_intents/${piId}`)
}

// ── Issue Refund ─────────────────────────────────────────────────────────────
export async function createRefund(
  env: Env,
  paymentIntentId: string,
  amountCents?: number
): Promise<any> {
  const body: Record<string, string | number> = { payment_intent: paymentIntentId }
  if (amountCents) body.amount = amountCents
  return stripeRequest(env, 'POST', '/refunds', body as any)
}

// ── Verify Stripe Webhook Signature ─────────────────────────────────────────
// Uses Web Crypto API — no Node.js required
export async function verifyWebhookSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = sigHeader.split(',')
    const tPart = parts.find(p => p.startsWith('t='))
    const v1Part = parts.find(p => p.startsWith('v1='))
    if (!tPart || !v1Part) return false

    const timestamp = tPart.slice(2)
    const signature = v1Part.slice(3)
    const signedPayload = `${timestamp}.${payload}`

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
    const expected = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison
    if (expected.length !== signature.length) return false
    let diff = 0
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
    }

    // Check timestamp is within 5 minutes
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp))
    return diff === 0 && age < 300
  } catch {
    return false
  }
}
