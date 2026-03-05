// ════════════════════════════════════════════════════════════════════════════
// ParkPeer — Centralized Notification Service
// Handles in-app storage, Resend email, and Twilio SMS for every platform event
// ════════════════════════════════════════════════════════════════════════════

import {
  smsSendBookingConfirmation,
  smsSendHostAlert,
  smsSendCancellation,
} from './twilio'

import {
  sendBookingConfirmation,
  sendHostBookingAlert,
  sendCancellationEmail,
  sendPayoutEmail,
  sendReviewReceivedEmail,
} from './sendgrid'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifType =
  | 'booking_request'
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_reminder'
  | 'payout_processed'
  | 'review_received'
  | 'new_registration'
  | 'new_listing'
  | 'dispute_opened'
  | 'refund_processed'
  | 'security_alert'
  | 'system'

export type UserRole = 'driver' | 'host' | 'admin'

interface NotifPayload {
  userId:         number
  userRole:       UserRole
  type:           NotifType
  title:          string
  message:        string
  relatedEntity?: { type: string; id: number | string }
}

interface Env {
  DB?:                  D1Database
  RESEND_API_KEY?:      string
  FROM_EMAIL?:          string
  TWILIO_ACCOUNT_SID?:  string
  TWILIO_AUTH_TOKEN?:   string
  TWILIO_PHONE_NUMBER?: string
}

// ── Preference helper ─────────────────────────────────────────────────────────

async function getPrefs(db: D1Database, userId: number) {
  const row = await db
    .prepare('SELECT * FROM notification_prefs WHERE user_id = ?')
    .bind(userId)
    .first<any>()
  return row || {
    booking_inapp: 1, booking_email: 1, booking_sms: 1,
    payout_inapp:  1, payout_email:  1, payout_sms:  1,
    review_inapp:  1, review_email:  1, review_sms:  0,
    system_inapp:  1, system_email:  1, system_sms:  0,
  }
}

// ── Core: store in-app notification ──────────────────────────────────────────

async function createInApp(db: D1Database, p: NotifPayload, deliverEmail: boolean, deliverSms: boolean): Promise<number> {
  const related = p.relatedEntity ? JSON.stringify(p.relatedEntity) : null
  try {
    const result = await db.prepare(`
      INSERT INTO notifications
        (user_id, user_role, type, title, message, related_entity,
         read_status, delivery_inapp, delivery_email, delivery_sms,
         email_sent, sms_sent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 0, 0, datetime('now'))
    `).bind(p.userId, p.userRole, p.type, p.title, p.message, related, deliverEmail ? 1 : 0, deliverSms ? 1 : 0).run()
    return Number(result.meta?.last_row_id ?? 0)
  } catch (e: any) {
    console.error('[createInApp]', e.message)
    return 0
  }
}

async function markEmailSent(db: D1Database, id: number) {
  if (!id) return
  await db.prepare('UPDATE notifications SET email_sent=1 WHERE id=?').bind(id).run().catch(() => {})
}

async function markSmsSent(db: D1Database, id: number) {
  if (!id) return
  await db.prepare('UPDATE notifications SET sms_sent=1 WHERE id=?').bind(id).run().catch(() => {})
}

// ── Admin notification ────────────────────────────────────────────────────────
// Admin notifications use user_id = 0 (special admin inbox)

export async function notifyAdmin(
  env: Env,
  type: NotifType,
  title: string,
  message: string,
  relatedEntity?: { type: string; id: number | string }
): Promise<void> {
  const db = env.DB
  if (!db) return
  const related = relatedEntity ? JSON.stringify(relatedEntity) : null
  await db.prepare(`
    INSERT INTO notifications
      (user_id, user_role, type, title, message, related_entity,
       read_status, delivery_inapp, delivery_email, delivery_sms,
       email_sent, sms_sent, created_at)
    VALUES (0, 'admin', ?, ?, ?, ?, 0, 1, 0, 0, 0, 0, datetime('now'))
  `).bind(type, title, message, related).run().catch((e: any) => console.error('[notifyAdmin]', e.message))
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT FUNCTIONS — call these from API routes
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Booking requested → HOST (alert) + DRIVER (confirmation of submission) ─
export async function notifyBookingRequest(env: Env, data: {
  driverId:       number
  driverName:     string
  driverEmail:    string
  driverPhone:    string | null
  hostId:         number
  hostName:       string
  hostEmail:      string
  hostPhone:      string | null
  bookingId:      number
  listingId:      number
  listingTitle:   string
  listingAddress: string
  startTime:      string
  endTime:        string
  totalCharged:   number   // what driver pays
  hostPayout:     number   // host's share
}): Promise<void> {
  const db = env.DB
  if (!db) return
  try {
    // ── Host: new booking alert ──────────────────────────────────────────
    const hPrefs = await getPrefs(db, data.hostId)
    const hNotifId = await createInApp(db, {
      userId:   data.hostId,
      userRole: 'host',
      type:     'booking_request',
      title:    '🚗 New Booking Request',
      message:  `${data.driverName} wants to book "${data.listingTitle}" · ${fmtRange(data.startTime, data.endTime)} · $${data.hostPayout.toFixed(2)} payout`,
      relatedEntity: { type: 'booking', id: data.bookingId },
    }, hPrefs.booking_email === 1, hPrefs.booking_sms === 1)

    if (hPrefs.booking_email === 1) {
      sendHostBookingAlert(env as any, {
        hostEmail: data.hostEmail, hostName: data.hostName,
        bookingId: data.bookingId, listingTitle: data.listingTitle,
        driverName: data.driverName, startTime: data.startTime,
        endTime: data.endTime, hostPayout: data.hostPayout,
      }).then(() => markEmailSent(db, hNotifId)).catch(() => {})
    }

    if (hPrefs.booking_sms === 1 && data.hostPhone) {
      smsSendHostAlert(env as any, {
        toPhone: data.hostPhone, hostName: data.hostName,
        bookingId: data.bookingId, listingTitle: data.listingTitle,
        driverName: data.driverName, startTime: data.startTime,
        endTime: data.endTime, hostPayout: data.hostPayout,
      }).then(() => markSmsSent(db, hNotifId)).catch(() => {})
    }

    // ── Driver: booking submitted confirmation ───────────────────────────
    const dPrefs = await getPrefs(db, data.driverId)
    await createInApp(db, {
      userId:   data.driverId,
      userRole: 'driver',
      type:     'booking_request',
      title:    '📋 Booking Submitted',
      message:  `Your request for "${data.listingTitle}" · ${fmtRange(data.startTime, data.endTime)} is pending host approval.`,
      relatedEntity: { type: 'booking', id: data.bookingId },
    }, false, false) // no duplicate email/SMS — Stripe confirm will send those

    // ── Admin ────────────────────────────────────────────────────────────
    notifyAdmin(env, 'booking_request', '🚗 New Booking',
      `${data.driverName} booked "${data.listingTitle}" — #${data.bookingId}`,
      { type: 'booking', id: data.bookingId })
  } catch (e: any) {
    console.error('[notifyBookingRequest]', e.message)
  }
}

// ── 2. Booking confirmed (payment captured) → DRIVER + HOST ──────────────────
export async function notifyBookingConfirmed(env: Env, data: {
  driverId:       number
  driverName:     string
  driverEmail:    string
  driverPhone:    string | null
  hostId:         number
  hostName:       string
  hostEmail:      string
  hostPhone:      string | null
  bookingId:      number
  listingTitle:   string
  listingAddress: string
  startTime:      string
  endTime:        string
  totalCharged:   number
  hostPayout:     number
  vehiclePlate?:  string
}): Promise<void> {
  const db = env.DB
  if (!db) return
  try {
    // ── Driver: booking confirmed ────────────────────────────────────────
    const dPrefs = await getPrefs(db, data.driverId)
    const dNotifId = await createInApp(db, {
      userId:   data.driverId,
      userRole: 'driver',
      type:     'booking_confirmed',
      title:    '✅ Booking Confirmed!',
      message:  `Your reservation at "${data.listingTitle}" is confirmed · ${fmtRange(data.startTime, data.endTime)} · $${data.totalCharged.toFixed(2)} charged`,
      relatedEntity: { type: 'booking', id: data.bookingId },
    }, dPrefs.booking_email === 1, dPrefs.booking_sms === 1)

    if (dPrefs.booking_email === 1) {
      sendBookingConfirmation(env as any, {
        driverEmail: data.driverEmail, driverName: data.driverName,
        bookingId: data.bookingId, listingTitle: data.listingTitle,
        listingAddress: data.listingAddress, startTime: data.startTime,
        endTime: data.endTime, totalCharged: data.totalCharged,
        vehiclePlate: data.vehiclePlate || '',
      }).then(() => markEmailSent(db, dNotifId)).catch(() => {})
    }

    if (dPrefs.booking_sms === 1 && data.driverPhone) {
      smsSendBookingConfirmation(env as any, {
        toPhone: data.driverPhone, driverName: data.driverName,
        bookingId: data.bookingId, listingTitle: data.listingTitle,
        listingAddress: data.listingAddress, startTime: data.startTime,
        endTime: data.endTime, totalCharged: data.totalCharged,
      }).then(() => markSmsSent(db, dNotifId)).catch(() => {})
    }

    // ── Host: payment received / booking confirmed ───────────────────────
    if (data.hostId > 0) {
      const hPrefs = await getPrefs(db, data.hostId)
      await createInApp(db, {
        userId:   data.hostId,
        userRole: 'host',
        type:     'booking_confirmed',
        title:    '💳 Payment Received',
        message:  `${data.driverName} paid for "${data.listingTitle}" · ${fmtRange(data.startTime, data.endTime)} · $${data.hostPayout.toFixed(2)} payout`,
        relatedEntity: { type: 'booking', id: data.bookingId },
      }, false, false) // host already got email alert at booking_request stage
    }
  } catch (e: any) {
    console.error('[notifyBookingConfirmed]', e.message)
  }
}

// ── 3. Booking cancelled → BOTH driver and host ───────────────────────────────
export async function notifyBookingCancelled(env: Env, data: {
  driverId:     number
  driverName:   string
  driverEmail:  string
  driverPhone:  string | null
  hostId:       number
  hostName:     string
  hostEmail:    string
  hostPhone:    string | null
  bookingId:    number
  listingTitle: string
  refundAmount: number
  cancelledBy:  string
}): Promise<void> {
  const db = env.DB
  if (!db) return
  try {
    // Driver notification
    const dPrefs = await getPrefs(db, data.driverId)
    const dNotifId = await createInApp(db, {
      userId:   data.driverId,
      userRole: 'driver',
      type:     'booking_cancelled',
      title:    'Booking Cancelled',
      message:  `Your booking at "${data.listingTitle}" was cancelled.${data.refundAmount > 0 ? ` $${data.refundAmount.toFixed(2)} will be refunded.` : ''}`,
      relatedEntity: { type: 'booking', id: data.bookingId },
    }, dPrefs.booking_email === 1, dPrefs.booking_sms === 1)

    if (dPrefs.booking_email === 1) {
      sendCancellationEmail(env as any, {
        toEmail: data.driverEmail, toName: data.driverName,
        bookingId: data.bookingId, listingTitle: data.listingTitle,
        refundAmount: data.refundAmount, cancelledBy: data.cancelledBy,
      }).then(() => markEmailSent(db, dNotifId)).catch(() => {})
    }
    if (dPrefs.booking_sms === 1 && data.driverPhone) {
      smsSendCancellation(env as any, {
        toPhone: data.driverPhone, bookingId: data.bookingId,
        listingTitle: data.listingTitle, refundAmount: data.refundAmount,
        cancelledBy: data.cancelledBy,
      }).then(() => markSmsSent(db, dNotifId)).catch(() => {})
    }

    // Host notification
    const hPrefs = await getPrefs(db, data.hostId)
    const hNotifId = await createInApp(db, {
      userId:   data.hostId,
      userRole: 'host',
      type:     'booking_cancelled',
      title:    'Booking Cancelled',
      message:  `Booking #${data.bookingId} for "${data.listingTitle}" was cancelled by ${data.cancelledBy}.`,
      relatedEntity: { type: 'booking', id: data.bookingId },
    }, hPrefs.booking_email === 1, hPrefs.booking_sms === 1)

    if (hPrefs.booking_email === 1) {
      sendCancellationEmail(env as any, {
        toEmail: data.hostEmail, toName: data.hostName,
        bookingId: data.bookingId, listingTitle: data.listingTitle,
        refundAmount: 0, cancelledBy: data.cancelledBy,
      }).then(() => markEmailSent(db, hNotifId)).catch(() => {})
    }
    if (hPrefs.booking_sms === 1 && data.hostPhone) {
      smsSendCancellation(env as any, {
        toPhone: data.hostPhone, bookingId: data.bookingId,
        listingTitle: data.listingTitle, refundAmount: 0,
        cancelledBy: data.cancelledBy,
      }).then(() => markSmsSent(db, hNotifId)).catch(() => {})
    }

    notifyAdmin(env, 'booking_cancelled', 'Booking Cancelled',
      `Booking #${data.bookingId} "${data.listingTitle}" cancelled by ${data.cancelledBy}`,
      { type: 'booking', id: data.bookingId })
  } catch (e: any) {
    console.error('[notifyBookingCancelled]', e.message)
  }
}

// ── 4. Payout processed → HOST ────────────────────────────────────────────────
export async function notifyPayoutProcessed(env: Env, data: {
  hostId:     number
  hostName:   string
  hostEmail:  string
  hostPhone:  string | null
  amount:     number
  bookingId?: number
}): Promise<void> {
  const db = env.DB
  if (!db) return
  try {
    const prefs = await getPrefs(db, data.hostId)
    const notifId = await createInApp(db, {
      userId:   data.hostId,
      userRole: 'host',
      type:     'payout_processed',
      title:    '💰 Payout Processed',
      message:  `$${data.amount.toFixed(2)} has been sent to your account.`,
      relatedEntity: data.bookingId ? { type: 'booking', id: data.bookingId } : undefined,
    }, prefs.payout_email === 1, prefs.payout_sms === 1)

    if (prefs.payout_email === 1) {
      sendPayoutEmail(env as any, {
        toEmail: data.hostEmail, toName: data.hostName,
        amount: data.amount, bookingId: data.bookingId,
      }).then(() => markEmailSent(db, notifId)).catch(() => {})
    }

    if (prefs.payout_sms === 1 && data.hostPhone && (env as any).TWILIO_ACCOUNT_SID) {
      const msg = `💰 ParkPeer Payout: $${data.amount.toFixed(2)} sent to your account. parkpeer.pages.dev/host`
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${(env as any).TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${(env as any).TWILIO_ACCOUNT_SID}:${(env as any).TWILIO_AUTH_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: (env as any).TWILIO_PHONE_NUMBER || '', To: data.hostPhone, Body: msg }).toString(),
      }).then(() => markSmsSent(db, notifId)).catch(() => {})
    }
  } catch (e: any) {
    console.error('[notifyPayoutProcessed]', e.message)
  }
}

// ── 5. Review received → HOST ─────────────────────────────────────────────────
export async function notifyReviewReceived(env: Env, data: {
  hostId:       number
  hostName:     string
  hostEmail:    string
  reviewerName: string
  rating:       number
  comment:      string
  listingId:    number
  listingTitle: string
}): Promise<void> {
  const db = env.DB
  if (!db) return
  try {
    const prefs = await getPrefs(db, data.hostId)
    const notifId = await createInApp(db, {
      userId:   data.hostId,
      userRole: 'host',
      type:     'review_received',
      title:    data.rating === 5 ? '⭐ New 5-Star Review!' : 'New Review Received',
      message:  `${data.reviewerName} left ${data.rating} stars for "${data.listingTitle}": "${data.comment.slice(0,80)}${data.comment.length > 80 ? '…' : ''}"`,
      relatedEntity: { type: 'listing', id: data.listingId },
    }, prefs.review_email === 1, false) // no SMS for reviews

    if (prefs.review_email === 1) {
      sendReviewReceivedEmail(env as any, {
        toEmail: data.hostEmail, toName: data.hostName,
        reviewerName: data.reviewerName, rating: data.rating,
        comment: data.comment, listingTitle: data.listingTitle,
        listingId: data.listingId,
      }).then(() => markEmailSent(db, notifId)).catch(() => {})
    }
  } catch (e: any) {
    console.error('[notifyReviewReceived]', e.message)
  }
}

// ── 6. New user registration → ADMIN ─────────────────────────────────────────
export async function notifyNewRegistration(env: Env, data: {
  userId:    number
  userName:  string
  userEmail: string
  role:      string
}): Promise<void> {
  notifyAdmin(env, 'new_registration', '👤 New User Registered',
    `${data.userName} (${data.userEmail}) joined as ${data.role}.`,
    { type: 'user', id: data.userId })
}

// ── 7. New listing created → ADMIN ────────────────────────────────────────────
export async function notifyNewListing(env: Env, data: {
  hostName:     string
  listingId:    number
  listingTitle: string
}): Promise<void> {
  notifyAdmin(env, 'new_listing', '🅿️ New Listing Created',
    `${data.hostName} created "${data.listingTitle}" (#${data.listingId}).`,
    { type: 'listing', id: data.listingId })
}

// ── 8. Dispute opened → ADMIN ─────────────────────────────────────────────────
export async function notifyDisputeOpened(env: Env, data: {
  bookingId: number
  disputeId: number
  reason:    string
}): Promise<void> {
  notifyAdmin(env, 'dispute_opened', '⚖️ Dispute Opened',
    `Dispute on Booking #${data.bookingId}: "${data.reason.slice(0,100)}"`,
    { type: 'dispute', id: data.disputeId })
}

// ── 9. Refund processed ───────────────────────────────────────────────────────
export async function notifyRefundProcessed(env: Env, data: {
  userId:    number
  userRole:  UserRole
  amount:    number
  bookingId: number
}): Promise<void> {
  const db = env.DB
  if (!db) return
  try {
    const prefs = await getPrefs(db, data.userId)
    await createInApp(db, {
      userId:   data.userId,
      userRole: data.userRole,
      type:     'refund_processed',
      title:    'Refund Processed',
      message:  `Your refund of $${data.amount.toFixed(2)} for booking #${data.bookingId} has been processed.`,
      relatedEntity: { type: 'booking', id: data.bookingId },
    }, prefs.payout_email === 1, false)

    notifyAdmin(env, 'refund_processed', '💸 Refund Issued',
      `$${data.amount.toFixed(2)} refunded for Booking #${data.bookingId}`,
      { type: 'booking', id: data.bookingId })
  } catch (e: any) {
    console.error('[notifyRefundProcessed]', e.message)
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────
function fmtRange(start: string, end: string): string {
  try {
    const s = new Date(start), e = new Date(end)
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    return `${fmt(s)} – ${fmt(e)}`
  } catch { return `${start} – ${end}` }
}
