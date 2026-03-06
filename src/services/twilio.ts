// ─── Twilio SMS Service ───────────────────────────────────────────────────────
// Uses Twilio REST API directly — no SDK, fully Cloudflare Workers compatible
// All calls are server-side only. Credentials never reach the browser.

const TWILIO_API = 'https://api.twilio.com/2010-04-01'

type Env = {
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
}

// ── Core SMS sender ───────────────────────────────────────────────────────────
async function sendSMS(env: Env, to: string, body: string): Promise<boolean> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    console.log(`[Twilio SKIP] Would send SMS to ${to}: ${body}`)
    return true
  }

  // Normalize phone number — ensure E.164 format
  const toNumber = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`

  const credentials = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)
  const url = `${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: env.TWILIO_PHONE_NUMBER,
        To:   toNumber,
        Body: body
      }).toString()
    })

    const data = await res.json() as any
    if (!res.ok) {
      console.error(`[Twilio ERROR] ${res.status}:`, data?.message || data)
      return false
    }

    console.log(`[Twilio OK] SID: ${data.sid} → ${toNumber}`)
    return true
  } catch (e) {
    console.error('[Twilio EXCEPTION]', e)
    return false
  }
}

// ── Verify Twilio webhook signature ──────────────────────────────────────────
export async function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): Promise<boolean> {
  try {
    // Build validation string: URL + sorted params concatenated
    const sortedKeys = Object.keys(params).sort()
    const validationStr = url + sortedKeys.map(k => k + params[k]).join('')

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(validationStr))
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))
    return expected === signature
  } catch {
    return false
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SMS TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Booking Confirmation → Driver ─────────────────────────────────────────
export async function smsSendBookingConfirmation(env: Env, data: {
  toPhone: string
  driverName: string
  bookingId: number
  listingTitle: string
  listingAddress: string
  startTime: string
  endTime: string
  totalCharged: number
  qrCheckinUrl?: string
}): Promise<boolean> {
  const msg =
    `✅ ParkPeer Booking Confirmed!\n` +
    `#PP-${String(data.bookingId).padStart(6, '0')} · ${data.listingTitle}\n` +
    `📍 ${data.listingAddress}\n` +
    `🕐 In: ${data.startTime}\n` +
    `🕐 Out: ${data.endTime}\n` +
    `💳 $${data.totalCharged.toFixed(2)} charged\n` +
    (data.qrCheckinUrl ? `📱 QR Check-in: ${data.qrCheckinUrl}\n` : '') +
    `Manage: parkpeer.pages.dev/dashboard`

  return sendSMS(env, data.toPhone, msg)
}

// ── 2. New Booking Alert → Host ───────────────────────────────────────────────
export async function smsSendHostAlert(env: Env, data: {
  toPhone: string
  hostName: string
  bookingId: number
  listingTitle: string
  driverName: string
  startTime: string
  endTime: string
  hostPayout: number
}): Promise<boolean> {
  const msg =
    `🚗 New ParkPeer Booking!\n` +
    `${data.driverName} booked "${data.listingTitle}"\n` +
    `📅 ${data.startTime} → ${data.endTime}\n` +
    `💰 Your payout: $${data.hostPayout.toFixed(2)}\n` +
    `Manage: parkpeer.pages.dev/host`

  return sendSMS(env, data.toPhone, msg)
}

// ── 3. Cancellation Notice ────────────────────────────────────────────────────
export async function smsSendCancellation(env: Env, data: {
  toPhone: string
  bookingId: number
  listingTitle: string
  refundAmount: number
  cancelledBy: string
}): Promise<boolean> {
  const msg =
    `❌ ParkPeer Booking Cancelled\n` +
    `#PP-${String(data.bookingId).padStart(6, '0')} · ${data.listingTitle}\n` +
    (data.refundAmount > 0
      ? `💚 Refund of $${data.refundAmount.toFixed(2)} processing (5-10 days)\n`
      : '') +
    `Find parking: parkpeer.pages.dev/search`

  return sendSMS(env, data.toPhone, msg)
}

// ── 4. Booking Reminder (sent 1 hour before) ──────────────────────────────────
export async function smsSendReminder(env: Env, data: {
  toPhone: string
  bookingId: number
  listingTitle: string
  listingAddress: string
  startTime: string
}): Promise<boolean> {
  const msg =
    `⏰ ParkPeer Reminder\n` +
    `Your parking at "${data.listingTitle}" starts at ${data.startTime}\n` +
    `📍 ${data.listingAddress}\n` +
    `Booking #PP-${String(data.bookingId).padStart(6, '0')}`

  return sendSMS(env, data.toPhone, msg)
}

// ── 5. OTP Verification ───────────────────────────────────────────────────────
export async function smsSendOTP(env: Env, data: {
  toPhone: string
  otp: string
}): Promise<boolean> {
  const msg =
    `🔐 ParkPeer verification code: ${data.otp}\n` +
    `Valid for 10 minutes. Do not share this code.`

  return sendSMS(env, data.toPhone, msg)
}

// ── 6. Payment Failed ─────────────────────────────────────────────────────────
export async function smsSendPaymentFailed(env: Env, data: {
  toPhone: string
  bookingId: number
  amount: number
}): Promise<boolean> {
  const msg =
    `⚠️ ParkPeer Payment Failed\n` +
    `$${data.amount.toFixed(2)} could not be processed for booking #PP-${String(data.bookingId).padStart(6, '0')}.\n` +
    `Update your payment: parkpeer.pages.dev/dashboard`

  return sendSMS(env, data.toPhone, msg)
}

// ── 7. Dispute Opened ─────────────────────────────────────────────────────────
export async function smsSendDisputeAlert(env: Env, data: {
  toPhone: string
  bookingId: number
  role: 'driver' | 'host'
}): Promise<boolean> {
  const msg =
    `⚖️ ParkPeer Dispute Opened\n` +
    `A dispute has been raised for booking #PP-${String(data.bookingId).padStart(6, '0')}.\n` +
    `Our team will review and contact you within 24 hours.\n` +
    `Dashboard: parkpeer.pages.dev/${data.role === 'host' ? 'host' : 'dashboard'}`

  return sendSMS(env, data.toPhone, msg)
}
