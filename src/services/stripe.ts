// ─── Stripe Service ──────────────────────────────────────────────────────────
// Uses Stripe REST API directly (no SDK) — Cloudflare Workers compatible
// All calls are server-side only. Keys never reach the browser.
//
// ── Payment distribution model ───────────────────────────────────────────────
// ParkPeer uses Stripe Connect (separate charges + transfers):
//
//   Driver pays:   $total  (subtotal + 15% platform fee)
//   Platform gets: $platform_fee  (15% of subtotal)
//   Host gets:     $host_payout   (85% of subtotal, i.e. subtotal - platform_fee)
//
// Correct fee math:
//   subtotal     = rate_per_hour × hours
//   platform_fee = round(subtotal × 0.15, 2)
//   host_payout  = subtotal - platform_fee          = round(subtotal × 0.85, 2)
//   total        = subtotal + platform_fee           = round(subtotal × 1.15, 2)
//
// ── Stripe Connect + Cash-out flow ───────────────────────────────────────────
//   1. create-intent  → PaymentIntent with application_fee_amount = fee_cents
//                       (captures full total to platform account)
//   2. payments/confirm → verify PI succeeded, record booking
//   3. dispatchHostPayout() → POST /v1/transfers to host's connected account
//                            (stripe_account_id from payout_info)
//   4. Webhook transfer.paid → mark stripe_transfer_id on payments row
//
// ── Host Cash-out (Connect Express Onboarding) ───────────────────────────────
//   A. createConnectAccount()  → POST /v1/accounts (type=express)
//   B. createAccountLink()     → POST /v1/account_links  (onboarding URL)
//   C. getConnectAccount()     → GET  /v1/accounts/:id   (status check)
//   D. getConnectBalance()     → GET  /v1/balance (as connected account)
//   E. createConnectPayout()   → POST /v1/payouts (as connected account)
//   F. listConnectPayouts()    → GET  /v1/payouts  (as connected account)
//   G. createLoginLink()       → POST /v1/accounts/:id/login_links (dashboard)
// ─────────────────────────────────────────────────────────────────────────────

const STRIPE_API = 'https://api.stripe.com/v1'

// Platform fee rate (15% of subtotal)
export const PLATFORM_FEE_RATE = 0.15

// Calculate the authoritative payment split from a subtotal amount
export function calcPaymentSplit(subtotalCents: number): {
  subtotalCents:   number
  platformFeeCents: number
  hostPayoutCents:  number
  totalCents:       number
} {
  const platformFeeCents = Math.round(subtotalCents * PLATFORM_FEE_RATE)
  const hostPayoutCents  = subtotalCents - platformFeeCents   // exactly subtotal × 0.85
  const totalCents       = subtotalCents + platformFeeCents   // subtotal × 1.15
  return { subtotalCents, platformFeeCents, hostPayoutCents, totalCents }
}

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
// amountCents        = total charge to driver (subtotal + platform fee)
// applicationFeeCents = platform_fee in cents (stays with platform account)
// hostStripeAccountId = host's connected Stripe account (receives host_payout
//                       automatically via Stripe's fee/transfer mechanics, OR
//                       we do a manual transfer post-capture if not using
//                       on_behalf_of).
//
// Strategy: Separate Charges + Manual Transfers
//   - Charge the full amount to the platform account
//   - application_fee_amount keeps the fee on the platform
//   - After confirm, call createTransfer() to push host_payout to host account
//
export async function createPaymentIntent(
  env: Env,
  amountCents: number,
  currency: string = 'usd',
  metadata: Record<string, string> = {},
  idempotencyKey?: string,
  applicationFeeCents?: number,   // platform fee in cents (stays with platform)
  hostStripeAccountId?: string    // host connected account (for transfer_group)
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const flatMeta: Record<string, string> = {}
  for (const [k, v] of Object.entries(metadata)) {
    flatMeta[`metadata[${k}]`] = String(v)
  }

  const piBody: Record<string, string | number | boolean> = {
    amount: amountCents,
    currency,
    'automatic_payment_methods[enabled]': 'true',
    ...flatMeta
  }

  // Stamp platform fee so it stays on the platform account.
  // The remaining (host_payout) will be transferred out to the host
  // via a manual Transfer after the charge succeeds.
  if (applicationFeeCents && applicationFeeCents > 0) {
    piBody['application_fee_amount'] = applicationFeeCents
  }

  // Transfer group ties the PI charge to any subsequent transfers
  // (enables Stripe's reconciliation and dispute management)
  if (hostStripeAccountId) {
    piBody['transfer_group'] = `booking-${metadata['checkout_token'] || idempotencyKey || 'unknown'}`
  }

  const pi = await stripeRequest(
    env, 'POST', '/payment_intents',
    piBody as any,
    idempotencyKey ? `pi-${idempotencyKey}` : undefined
  )

  return { clientSecret: pi.client_secret, paymentIntentId: pi.id }
}

// ── Create Stripe Transfer (host payout) ─────────────────────────────────────
// Called after payment succeeds to push host_payout to the host's connected account.
// Uses the charge ID from the PI as the source_transaction for proper reconciliation.
export async function createTransfer(
  env: Env,
  opts: {
    amountCents:        number        // host_payout in cents
    currency:           string
    destinationAccount: string        // host's stripe_account_id
    sourceTransaction:  string        // stripe_charge_id from the PI
    transferGroup?:     string        // must match PI transfer_group
    metadata?:          Record<string, string>
  },
  idempotencyKey?: string
): Promise<{ transferId: string; status: string }> {
  const body: Record<string, string | number> = {
    amount:       opts.amountCents,
    currency:     opts.currency,
    destination:  opts.destinationAccount,
    source_transaction: opts.sourceTransaction,
  }
  if (opts.transferGroup) body['transfer_group'] = opts.transferGroup
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }

  const transfer = await stripeRequest(
    env, 'POST', '/transfers',
    body as any,
    idempotencyKey ? `tr-${idempotencyKey}` : undefined
  )
  return { transferId: transfer.id, status: transfer.status || 'pending' }
}

// ── Retrieve Transfer ─────────────────────────────────────────────────────────
export async function getTransfer(env: Env, transferId: string): Promise<any> {
  return stripeRequest(env, 'GET', `/transfers/${transferId}`)
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

// ════════════════════════════════════════════════════════════════════════════
// STRIPE CONNECT — Express Onboarding + Cash-out
// ════════════════════════════════════════════════════════════════════════════

// ── Helper: call Stripe API as a connected account (Stripe-Account header) ──
async function stripeConnectRequest(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, string | number | boolean>,
  connectedAccountId?: string,   // Stripe-Account header (act as connected acct)
  idempotencyKey?: string
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-06-20',
  }
  if (connectedAccountId) headers['Stripe-Account'] = connectedAccountId
  if (idempotencyKey)     headers['Idempotency-Key'] = idempotencyKey

  const options: RequestInit = { method, headers }
  if (body && Object.keys(body).length > 0) {
    options.body = new URLSearchParams(body as Record<string, string>).toString()
  }

  const res  = await fetch(`${STRIPE_API}${path}`, options)
  const data = await res.json() as any
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe error ${res.status}: ${JSON.stringify(data?.error)}`)
  }
  return data
}

// ── A. Create Stripe Connect Express Account ─────────────────────────────────
// Creates a new Express connected account for a host.
// Express accounts handle ID verification + bank linking via Stripe's hosted UI.
export async function createConnectAccount(
  env: Env,
  opts: {
    email:         string
    country?:      string   // ISO-3166 2-letter, default 'US'
    businessType?: 'individual' | 'company'
    metadata?:     Record<string, string>
  }
): Promise<{ accountId: string }> {
  const body: Record<string, string> = {
    type:                    'express',
    country:                 opts.country || 'US',
    email:                   opts.email,
    'capabilities[transfers][requested]': 'true',
    'capabilities[card_payments][requested]': 'true',
    'business_type':         opts.businessType || 'individual',
    'settings[payouts][schedule][interval]': 'manual',  // manual payout by default
    'metadata[platform]':    'parkpeer',
  }
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }
  const acct = await stripeRequest(env, 'POST', '/accounts', body as any)
  return { accountId: acct.id }
}

// ── B. Create Account Link (Onboarding URL) ───────────────────────────────────
// Generates a one-time Stripe-hosted onboarding URL for the host.
// refresh_url: called if link expires; return_url: called when onboarding done.
export async function createAccountLink(
  env: Env,
  opts: {
    accountId:   string
    refreshUrl:  string    // e.g. https://parkpeer.pages.dev/host/connect/refresh
    returnUrl:   string    // e.g. https://parkpeer.pages.dev/host/connect/complete
    linkType?:   'account_onboarding' | 'account_update'
  }
): Promise<{ url: string; expiresAt: number }> {
  const link = await stripeRequest(env, 'POST', '/account_links', {
    account:      opts.accountId,
    refresh_url:  opts.refreshUrl,
    return_url:   opts.returnUrl,
    type:         opts.linkType || 'account_onboarding',
  } as any)
  return { url: link.url, expiresAt: link.expires_at }
}

// ── C. Get Connected Account Details ─────────────────────────────────────────
export async function getConnectAccount(
  env: Env,
  accountId: string
): Promise<{
  id: string
  email: string
  businessType: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  requirements: any
  capabilities: any
}> {
  const acct = await stripeRequest(env, 'GET', `/accounts/${accountId}`)
  return {
    id:               acct.id,
    email:            acct.email,
    businessType:     acct.business_type,
    chargesEnabled:   acct.charges_enabled,
    payoutsEnabled:   acct.payouts_enabled,
    detailsSubmitted: acct.details_submitted,
    requirements:     acct.requirements,
    capabilities:     acct.capabilities,
  }
}

// ── D. Get Connected Account Balance ─────────────────────────────────────────
// Retrieves the balance for a connected account (funds available for payout).
export async function getConnectBalance(
  env: Env,
  connectedAccountId: string
): Promise<{
  availableUsd:  number   // dollars
  pendingUsd:    number   // dollars (in transit, not yet available)
}> {
  const bal = await stripeConnectRequest(
    env, 'GET', '/balance', undefined, connectedAccountId
  )
  const avail   = bal.available?.find((b: any) => b.currency === 'usd')?.amount ?? 0
  const pending = bal.pending?.find((b: any)   => b.currency === 'usd')?.amount ?? 0
  return {
    availableUsd: avail   / 100,
    pendingUsd:   pending / 100,
  }
}

// ── E. Create Payout (cash-out to bank) ──────────────────────────────────────
// Sends available funds from the connected account to its default bank account.
// Amount is in CENTS. If amount is 0 / omitted, Stripe pays out the full balance.
export async function createConnectPayout(
  env: Env,
  connectedAccountId: string,
  opts: {
    amountCents:    number       // 0 = full available balance
    currency?:      string
    statementDesc?: string
    metadata?:      Record<string, string>
  },
  idempotencyKey?: string
): Promise<{
  payoutId:    string
  status:      string   // 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled'
  amountCents: number
  arrivalDate: number   // unix timestamp
}> {
  const body: Record<string, string | number> = {
    amount:   opts.amountCents,
    currency: opts.currency || 'usd',
    method:   'standard',
  }
  if (opts.statementDesc) body['statement_descriptor'] = opts.statementDesc.slice(0, 22)
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }

  const payout = await stripeConnectRequest(
    env, 'POST', '/payouts',
    body as any, connectedAccountId,
    idempotencyKey ? `po-${idempotencyKey}` : undefined
  )
  return {
    payoutId:    payout.id,
    status:      payout.status,
    amountCents: payout.amount,
    arrivalDate: payout.arrival_date,
  }
}

// ── F. List Payouts for Connected Account ────────────────────────────────────
export async function listConnectPayouts(
  env: Env,
  connectedAccountId: string,
  opts: { limit?: number; startingAfter?: string } = {}
): Promise<Array<{
  payoutId:    string
  status:      string
  amountCents: number
  amountUsd:   number
  arrivalDate: number
  created:     number
  description: string
}>> {
  const params = new URLSearchParams()
  params.set('limit', String(opts.limit || 10))
  if (opts.startingAfter) params.set('starting_after', opts.startingAfter)

  const list = await stripeConnectRequest(
    env, 'GET', `/payouts?${params}`, undefined, connectedAccountId
  )
  return (list.data || []).map((p: any) => ({
    payoutId:    p.id,
    status:      p.status,
    amountCents: p.amount,
    amountUsd:   p.amount / 100,
    arrivalDate: p.arrival_date,
    created:     p.created,
    description: p.description || '',
  }))
}

// ── G. Create Login Link (Stripe Express Dashboard) ───────────────────────────
// Generates a one-time URL for the host to access their Stripe Express dashboard
// where they can view payouts, update bank account, manage identity verification.
export async function createLoginLink(
  env: Env,
  accountId: string
): Promise<{ url: string }> {
  const link = await stripeRequest(env, 'POST', `/accounts/${accountId}/login_links`, {} as any)
  return { url: link.url }
}

// ── H. Update Payout Schedule for Connected Account ──────────────────────────
// interval: 'manual' | 'daily' | 'weekly' | 'monthly'
export async function updatePayoutSchedule(
  env: Env,
  accountId: string,
  interval: 'manual' | 'daily' | 'weekly' | 'monthly',
  opts: { weeklyAnchor?: string; monthlyAnchor?: number } = {}
): Promise<void> {
  const body: Record<string, string | number> = {
    'settings[payouts][schedule][interval]': interval,
  }
  if (interval === 'weekly'  && opts.weeklyAnchor)  body['settings[payouts][schedule][weekly_anchor]']  = opts.weeklyAnchor
  if (interval === 'monthly' && opts.monthlyAnchor) body['settings[payouts][schedule][monthly_anchor]'] = opts.monthlyAnchor

  await stripeRequest(env, 'POST', `/accounts/${accountId}`, body as any)
}

// ── I. Retrieve a single Payout ───────────────────────────────────────────────
export async function getConnectPayout(
  env: Env,
  connectedAccountId: string,
  payoutId: string
): Promise<any> {
  return stripeConnectRequest(env, 'GET', `/payouts/${payoutId}`, undefined, connectedAccountId)
}

// ── J. Cancel a Pending Payout ───────────────────────────────────────────────
export async function cancelConnectPayout(
  env: Env,
  connectedAccountId: string,
  payoutId: string
): Promise<any> {
  return stripeConnectRequest(env, 'POST', `/payouts/${payoutId}/cancel`, {}, connectedAccountId)
}

