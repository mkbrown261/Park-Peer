// ─── SendGrid Email Service ───────────────────────────────────────────────────
// Uses SendGrid Web API v3 directly — no SDK, fully Cloudflare Workers compatible
// All sending is server-side only. API key never reaches the browser.

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'

type Env = {
  SENDGRID_API_KEY: string
  FROM_EMAIL: string
}

interface EmailPayload {
  to: string
  toName?: string
  subject: string
  htmlContent: string
  textContent?: string
}

// ── Core send function ────────────────────────────────────────────────────────
async function sendEmail(env: Env, payload: EmailPayload): Promise<boolean> {
  // If no real key configured yet, log and skip gracefully
  if (!env.SENDGRID_API_KEY || env.SENDGRID_API_KEY === 'PLACEHOLDER_SENDGRID_KEY') {
    console.log(`[SendGrid SKIP] Would send "${payload.subject}" to ${payload.to}`)
    return true
  }

  const fromEmail = env.FROM_EMAIL || 'noreply@parkpeer.pages.dev'
  const fromName = 'ParkPeer'

  const body = {
    personalizations: [{ to: [{ email: payload.to, name: payload.toName || payload.to }] }],
    from: { email: fromEmail, name: fromName },
    reply_to: { email: fromEmail, name: fromName },
    subject: payload.subject,
    content: [
      { type: 'text/plain', value: payload.textContent || payload.subject },
      { type: 'text/html',  value: payload.htmlContent }
    ]
  }

  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    if (res.status >= 400) {
      const err = await res.text()
      console.error('[SendGrid ERROR]', res.status, err)
      return false
    }
    return true
  } catch (e) {
    console.error('[SendGrid EXCEPTION]', e)
    return false
  }
}

// ── Shared email wrapper / footer ─────────────────────────────────────────────
function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ParkPeer</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#5B2EFF,#3a12d4);padding:32px 40px;border-radius:16px 16px 0 0;text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:12px;">
              <div style="width:44px;height:44px;background:rgba(255,255,255,0.15);border-radius:12px;display:inline-block;text-align:center;line-height:44px;font-size:20px;">🅿️</div>
              <span style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Park<span style="color:#C6FF00;">Peer</span></span>
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:40px;border-radius:0 0 16px 16px;">
            ${content}
            <hr style="border:none;border-top:1px solid #eee;margin:32px 0;"/>
            <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
              © ${new Date().getFullYear()} ParkPeer · Peer-to-peer parking marketplace<br/>
              <a href="https://parkpeer.pages.dev" style="color:#5B2EFF;text-decoration:none;">parkpeer.pages.dev</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── 1. Booking Confirmation (to Driver) ───────────────────────────────────────
export async function sendBookingConfirmation(env: Env, data: {
  driverEmail: string
  driverName: string
  bookingId: number
  listingTitle: string
  listingAddress: string
  startTime: string
  endTime: string
  totalCharged: number
  vehiclePlate: string
}): Promise<boolean> {
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">✅ Booking Confirmed!</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">Your parking spot is reserved. Here are your details:</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;">Booking ID</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:700;">#PP-${String(data.bookingId).padStart(6,'0')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Location</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:600;">${data.listingTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Address</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;">${data.listingAddress}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Check-in</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:600;">${data.startTime}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Check-out</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:600;">${data.endTime}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Vehicle</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;">${data.vehiclePlate}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Total Paid</td>
            <td style="padding:6px 0;color:#5B2EFF;font-size:16px;font-weight:800;">$${data.totalCharged.toFixed(2)}</td></tr>
      </table>
    </div>

    <a href="https://parkpeer.pages.dev/dashboard" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">View My Booking →</a>

    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">Need help? Reply to this email or visit your dashboard to manage your booking.</p>
  `)

  return sendEmail(env, {
    to: data.driverEmail,
    toName: data.driverName,
    subject: `✅ Booking Confirmed — ${data.listingTitle} · #PP-${String(data.bookingId).padStart(6,'0')}`,
    htmlContent: html,
    textContent: `Booking Confirmed! #PP-${String(data.bookingId).padStart(6,'0')} at ${data.listingTitle}, ${data.listingAddress}. From ${data.startTime} to ${data.endTime}. Total: $${data.totalCharged.toFixed(2)}.`
  })
}

// ── 2. New Booking Alert (to Host) ────────────────────────────────────────────
export async function sendHostBookingAlert(env: Env, data: {
  hostEmail: string
  hostName: string
  bookingId: number
  listingTitle: string
  driverName: string
  startTime: string
  endTime: string
  hostPayout: number
}): Promise<boolean> {
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">🚗 New Booking on Your Space!</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">Someone just booked your parking space.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;">Booking ID</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:700;">#PP-${String(data.bookingId).padStart(6,'0')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Your Space</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:600;">${data.listingTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Driver</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;">${data.driverName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Check-in</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:600;">${data.startTime}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Check-out</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:600;">${data.endTime}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Your Payout</td>
            <td style="padding:6px 0;color:#16a34a;font-size:16px;font-weight:800;">$${data.hostPayout.toFixed(2)}</td></tr>
      </table>
    </div>

    <a href="https://parkpeer.pages.dev/host" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">View Host Dashboard →</a>
  `)

  return sendEmail(env, {
    to: data.hostEmail,
    toName: data.hostName,
    subject: `🚗 New Booking — ${data.listingTitle} · $${data.hostPayout.toFixed(2)} payout`,
    htmlContent: html,
    textContent: `New booking on ${data.listingTitle} by ${data.driverName}. From ${data.startTime} to ${data.endTime}. Your payout: $${data.hostPayout.toFixed(2)}.`
  })
}

// ── 3. Booking Cancellation ───────────────────────────────────────────────────
export async function sendCancellationEmail(env: Env, data: {
  toEmail: string
  toName: string
  bookingId: number
  listingTitle: string
  refundAmount: number
  cancelledBy: string
}): Promise<boolean> {
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">❌ Booking Cancelled</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">Booking #PP-${String(data.bookingId).padStart(6,'0')} for <strong>${data.listingTitle}</strong> has been cancelled by the ${data.cancelledBy}.</p>
    ${data.refundAmount > 0 ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="color:#15803d;font-weight:700;font-size:15px;margin:0;">💚 Refund of <strong>$${data.refundAmount.toFixed(2)}</strong> will be returned to your original payment method within 5–10 business days.</p>
    </div>` : ''}
    <a href="https://parkpeer.pages.dev/search" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">Find Another Space →</a>
  `)

  return sendEmail(env, {
    to: data.toEmail,
    toName: data.toName,
    subject: `❌ Booking Cancelled — #PP-${String(data.bookingId).padStart(6,'0')}`,
    htmlContent: html,
    textContent: `Booking #PP-${String(data.bookingId).padStart(6,'0')} for ${data.listingTitle} was cancelled. Refund: $${data.refundAmount.toFixed(2)}.`
  })
}

// ── 4. Payment Receipt ────────────────────────────────────────────────────────
export async function sendPaymentReceipt(env: Env, data: {
  toEmail: string
  toName: string
  bookingId: number
  amount: number
  last4?: string
  listingTitle: string
}): Promise<boolean> {
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">🧾 Payment Receipt</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">Payment confirmed for your ParkPeer booking.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;">Booking</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:700;">#PP-${String(data.bookingId).padStart(6,'0')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Space</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;">${data.listingTitle}</td></tr>
        ${data.last4 ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Card</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;">•••• ${data.last4}</td></tr>` : ''}
        <tr><td style="padding:8px 0 0;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;">Amount Charged</td>
            <td style="padding:8px 0 0;color:#5B2EFF;font-size:18px;font-weight:800;border-top:1px solid #e5e7eb;">$${data.amount.toFixed(2)}</td></tr>
      </table>
    </div>

    <a href="https://parkpeer.pages.dev/dashboard" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">View Dashboard →</a>
  `)

  return sendEmail(env, {
    to: data.toEmail,
    toName: data.toName,
    subject: `🧾 Receipt — $${data.amount.toFixed(2)} · ParkPeer #PP-${String(data.bookingId).padStart(6,'0')}`,
    htmlContent: html,
    textContent: `Payment of $${data.amount.toFixed(2)} confirmed for booking #PP-${String(data.bookingId).padStart(6,'0')} at ${data.listingTitle}.`
  })
}

// ── 5. Welcome Email ──────────────────────────────────────────────────────────
export async function sendWelcomeEmail(env: Env, data: {
  toEmail: string
  toName: string
  role: string
}): Promise<boolean> {
  const isHost = data.role === 'HOST' || data.role === 'BOTH'
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">👋 Welcome to ParkPeer, ${data.toName.split(' ')[0]}!</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 24px;">
      ${isHost
        ? 'Your host account is ready. Start listing your parking space and earning money today.'
        : 'Your account is ready. Find and book affordable parking near you.'
      }
    </p>

    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:24px;margin-bottom:28px;">
      <h3 style="color:#5B2EFF;font-size:15px;font-weight:700;margin:0 0 16px;">🚀 Get started in 3 steps</h3>
      ${isHost ? `
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">1. 📍 <strong>List your space</strong> — add photos, set your rate, and go live in minutes</p>
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">2. 💳 <strong>Connect Stripe</strong> — so you can receive payouts directly</p>
      <p style="color:#374151;font-size:14px;margin:0;">3. 🎉 <strong>Start earning</strong> — drivers in your area will find and book your space</p>
      ` : `
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">1. 🔍 <strong>Search for parking</strong> — find spaces near your destination</p>
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">2. 📅 <strong>Book instantly</strong> — reserve your spot in seconds</p>
      <p style="color:#374151;font-size:14px;margin:0;">3. 🚗 <strong>Park & go</strong> — access details sent straight to your dashboard</p>
      `}
    </div>

    <a href="https://parkpeer.pages.dev/${isHost ? 'host' : 'search'}" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">
      ${isHost ? 'List My Space →' : 'Find Parking →'}
    </a>
  `)

  return sendEmail(env, {
    to: data.toEmail,
    toName: data.toName,
    subject: `👋 Welcome to ParkPeer — let's get you parked!`,
    htmlContent: html,
    textContent: `Welcome to ParkPeer, ${data.toName}! Your account is ready. Visit https://parkpeer.pages.dev to get started.`
  })
}
