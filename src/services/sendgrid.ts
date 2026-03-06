// ─── Resend Email Service ─────────────────────────────────────────────────────
// Uses Resend REST API — no SDK, fully Cloudflare Workers compatible
// Replaces SendGrid. All sending is server-side only.

const RESEND_API = 'https://api.resend.com/emails'

type Env = {
  RESEND_API_KEY: string
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
  if (!env.RESEND_API_KEY) {
    console.log(`[Resend SKIP] Would send "${payload.subject}" to ${payload.to}`)
    return true
  }

  const fromEmail = env.FROM_EMAIL || 'onboarding@resend.dev'
  const fromName  = 'ParkPeer'

  const body = {
    from:    `${fromName} <${fromEmail}>`,
    to:      [payload.toName ? `${payload.toName} <${payload.to}>` : payload.to],
    subject: payload.subject,
    html:    payload.htmlContent,
    text:    payload.textContent || payload.subject
  }

  try {
    const res = await fetch(RESEND_API, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = await res.json() as any
    if (!res.ok) {
      console.error('[Resend ERROR]', res.status, data)
      return false
    }
    console.log('[Resend OK] id:', data.id, '→', payload.to)
    return true
  } catch (e) {
    console.error('[Resend EXCEPTION]', e)
    return false
  }
}

// ── Shared branded email wrapper ──────────────────────────────────────────────
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
            <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">🅿️ Park<span style="color:#C6FF00;">Peer</span></span>
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

// ════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Booking Confirmation → Driver ─────────────────────────────────────────
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
  qrCodeImageUrl?: string
  qrCheckinUrl?:  string
}): Promise<boolean> {
  const qrSection = data.qrCodeImageUrl ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
      <p style="color:#166534;font-size:13px;font-weight:700;margin:0 0 12px;">📱 Your QR Check-in Code</p>
      <img src="${data.qrCodeImageUrl}" width="160" height="160" alt="QR Check-in Code"
        style="border-radius:8px;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.12);"/>
      <p style="color:#4b5563;font-size:12px;margin:12px 0 0;">Show this QR code when you arrive at the parking spot.<br/>
        <a href="${data.qrCheckinUrl || '#'}" style="color:#5B2EFF;">Tap here to open check-in on mobile →</a>
      </p>
    </div>
  ` : ''

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
        <tr><td style="padding:8px 0 0;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;">Total Paid</td>
            <td style="padding:8px 0 0;color:#5B2EFF;font-size:16px;font-weight:800;border-top:1px solid #e5e7eb;">$${data.totalCharged.toFixed(2)}</td></tr>
      </table>
    </div>

    ${qrSection}

    <a href="https://parkpeer.pages.dev/dashboard" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">View My Booking →</a>
    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">Need help? Visit your dashboard to manage your booking.</p>
  `)

  return sendEmail(env, {
    to: data.driverEmail,
    toName: data.driverName,
    subject: `✅ Booking Confirmed — ${data.listingTitle} · #PP-${String(data.bookingId).padStart(6,'0')}`,
    htmlContent: html,
    textContent: `Booking Confirmed! #PP-${String(data.bookingId).padStart(6,'0')} at ${data.listingTitle}, ${data.listingAddress}. From ${data.startTime} to ${data.endTime}. Total: $${data.totalCharged.toFixed(2)}.${data.qrCheckinUrl ? '\n\nQR Check-in: ' + data.qrCheckinUrl : ''}`
  })
}

// ── 2. New Booking Alert → Host ───────────────────────────────────────────────
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
        <tr><td style="padding:8px 0 0;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;">Your Payout</td>
            <td style="padding:8px 0 0;color:#16a34a;font-size:16px;font-weight:800;border-top:1px solid #e5e7eb;">$${data.hostPayout.toFixed(2)}</td></tr>
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

// ── 3. Cancellation ───────────────────────────────────────────────────────────
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
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">Booking <strong>#PP-${String(data.bookingId).padStart(6,'0')}</strong> for <strong>${data.listingTitle}</strong> has been cancelled by the ${data.cancelledBy}.</p>
    ${data.refundAmount > 0 ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="color:#15803d;font-weight:700;font-size:15px;margin:0;">💚 Refund of <strong>$${data.refundAmount.toFixed(2)}</strong> processing — 5–10 business days.</p>
    </div>` : ''}
    <a href="https://parkpeer.pages.dev/search" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">Find Another Space →</a>
  `)

  return sendEmail(env, {
    to: data.toEmail, toName: data.toName,
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
    to: data.toEmail, toName: data.toName,
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
      ${isHost ? 'Your host account is ready. Start listing your parking space and earning money today.' : 'Your account is ready. Find and book affordable parking near you.'}
    </p>

    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:24px;margin-bottom:28px;">
      <h3 style="color:#5B2EFF;font-size:15px;font-weight:700;margin:0 0 16px;">🚀 Get started in 3 steps</h3>
      ${isHost ? `
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">1. 📍 <strong>List your space</strong> — add photos, set your rate, go live in minutes</p>
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">2. 💳 <strong>Connect Stripe</strong> — receive payouts directly to your bank</p>
      <p style="color:#374151;font-size:14px;margin:0;">3. 🎉 <strong>Start earning</strong> — drivers near you will find and book your space</p>
      ` : `
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">1. 🔍 <strong>Search for parking</strong> — find spaces near your destination</p>
      <p style="color:#374151;font-size:14px;margin:0 0 10px;">2. 📅 <strong>Book instantly</strong> — reserve your spot in seconds</p>
      <p style="color:#374151;font-size:14px;margin:0;">3. 🚗 <strong>Park &amp; go</strong> — access details sent to your dashboard</p>
      `}
    </div>

    <a href="https://parkpeer.pages.dev/${isHost ? 'host' : 'search'}" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">
      ${isHost ? 'List My Space →' : 'Find Parking →'}
    </a>
  `)

  return sendEmail(env, {
    to: data.toEmail, toName: data.toName,
    subject: `👋 Welcome to ParkPeer — let's get you parked!`,
    htmlContent: html,
    textContent: `Welcome to ParkPeer, ${data.toName}! Your account is ready. Visit https://parkpeer.pages.dev to get started.`
  })
}

// ── 6. Listing Removed / Archived → Host ─────────────────────────────────────
export async function sendListingRemovedEmail(env: Env, data: {
  hostEmail: string
  hostName: string
  listingTitle: string
  listingAddress: string
  action: 'archived' | 'removed'
}): Promise<boolean> {
  const isArchive = data.action === 'archived'
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">
      ${isArchive ? '📦 Listing Archived' : '🗑️ Listing Removed'}
    </h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 24px;">
      Your parking space has been ${isArchive ? 'archived and is no longer visible to drivers. You can restore it any time from your Host Dashboard.' : 'permanently removed from ParkPeer.'}</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;">Space</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;font-weight:700;">${data.listingTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Address</td>
            <td style="padding:6px 0;color:#121212;font-size:13px;">${data.listingAddress}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Status</td>
            <td style="padding:6px 0;font-size:13px;font-weight:700;color:${isArchive ? '#d97706' : '#dc2626'};">${isArchive ? '📦 Archived' : '🗑️ Removed'}</td></tr>
      </table>
    </div>

    ${isArchive ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="color:#92400e;font-size:13px;margin:0;"><strong>💡 Tip:</strong> Archived listings keep all their reviews and booking history. Restore your listing in the Host Dashboard whenever you're ready to accept bookings again.</p>
    </div>
    ` : ''}

    <a href="https://parkpeer.pages.dev/host" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">Go to Host Dashboard →</a>
    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">Have questions? Contact us at <a href="mailto:support@parkpeer.com" style="color:#5B2EFF;">support@parkpeer.com</a></p>
  `)

  return sendEmail(env, {
    to: data.hostEmail,
    toName: data.hostName,
    subject: isArchive
      ? `📦 Listing Archived — ${data.listingTitle}`
      : `🗑️ Listing Removed — ${data.listingTitle}`,
    htmlContent: html,
    textContent: `Your listing "${data.listingTitle}" at ${data.listingAddress} has been ${data.action}. Visit https://parkpeer.pages.dev/host to manage your listings.`
  })
}

// ── 7. Payout Processed → Host ────────────────────────────────────────────────
export async function sendPayoutEmail(env: Env, data: {
  toEmail:    string
  toName:     string
  amount:     number
  bookingId?: number
}): Promise<boolean> {
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">💰 Payout Processed!</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">Great news — your earnings have been transferred.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
      <p style="color:#166534;font-size:14px;margin:0 0 8px;">Amount Transferred</p>
      <p style="color:#16a34a;font-size:36px;font-weight:900;margin:0;">$${data.amount.toFixed(2)}</p>
      ${data.bookingId ? `<p style="color:#6b7280;font-size:13px;margin:8px 0 0;">Booking #PP-${String(data.bookingId).padStart(6,'0')}</p>` : ''}
    </div>
    <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Funds typically arrive within 1–2 business days depending on your bank.</p>
    <a href="https://parkpeer.pages.dev/host" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">View Earnings →</a>
  `)
  return sendEmail(env, {
    to: data.toEmail, toName: data.toName,
    subject: `💰 Payout of $${data.amount.toFixed(2)} Processed — ParkPeer`,
    htmlContent: html,
    textContent: `Your payout of $${data.amount.toFixed(2)} has been processed. Funds arrive in 1-2 business days.`
  })
}

// ── 8. Review Received → Host ─────────────────────────────────────────────────
export async function sendReviewReceivedEmail(env: Env, data: {
  toEmail:      string
  toName:       string
  reviewerName: string
  rating:       number
  comment:      string
  listingTitle: string
  listingId:    number
}): Promise<boolean> {
  const stars = '⭐'.repeat(Math.min(5, data.rating))
  const html = emailWrapper(`
    <h2 style="color:#121212;font-size:22px;font-weight:800;margin:0 0 8px;">${data.rating === 5 ? '🌟 You got a 5-star review!' : '⭐ New Review Received'}</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 28px;">${data.reviewerName} left a review for <strong>${data.listingTitle}</strong>.</p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="font-size:24px;margin:0 0 12px;">${stars}</p>
      <p style="color:#374151;font-size:15px;font-style:italic;margin:0;">"${data.comment}"</p>
      <p style="color:#9ca3af;font-size:13px;margin:12px 0 0;">— ${data.reviewerName}</p>
    </div>
    <a href="https://parkpeer.pages.dev/listing?id=${data.listingId}" style="display:inline-block;background:linear-gradient(135deg,#5B2EFF,#4a20f0);color:#fff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">View Listing →</a>
  `)
  return sendEmail(env, {
    to: data.toEmail, toName: data.toName,
    subject: `${stars} New ${data.rating}-star review for "${data.listingTitle}"`,
    htmlContent: html,
    textContent: `${data.reviewerName} gave you ${data.rating} stars for "${data.listingTitle}": "${data.comment}"`
  })
}
