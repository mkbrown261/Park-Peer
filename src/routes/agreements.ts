/**
 * ParkPeer — Agreement & Cancellation Policy Module
 * ──────────────────────────────────────────────────────────────────────────────
 * Routes:
 *   GET  /api/agreements/status          — check user's acceptance status
 *   POST /api/agreements/accept          — record acceptance of a document
 *   GET  /legal/host-agreement           — full Host Agreement page
 *   GET  /legal/cancellation-policy      — full Cancellation Policy page
 *
 * Helper exports (used by other route files):
 *   CURRENT_VERSIONS                     — document_type → version map
 *   requireAgreement()                   — middleware: blocks action if not accepted
 *   recordAcceptance()                   — utility: insert into agreement_acceptances
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { requireUserAuth, verifyCsrf } from '../middleware/security'

// ── Current canonical versions ───────────────────────────────────────────────
export const CURRENT_VERSIONS: Record<string, string> = {
  host_agreement:      '1.0',
  cancellation_policy: '1.0',
  terms_of_service:    '1.0',
  privacy_policy:      '1.0',
}

// ── Full Host Agreement text ─────────────────────────────────────────────────
export const HOST_AGREEMENT_TEXT = `
<h2 class="text-2xl font-bold text-white mb-2">ParkPeer Host Agreement</h2>
<p class="text-gray-400 text-sm mb-6">Version 1.0 &nbsp;·&nbsp; Effective January 1, 2026</p>

<p class="text-gray-300 mb-4">
  This Host Agreement ("Agreement") is entered into between ParkPeer, Inc. ("ParkPeer," "we," "us")
  and you, the individual or entity listing a parking space on the ParkPeer platform ("Host," "you").
  By creating a listing or accepting a booking on ParkPeer you agree to be bound by this Agreement,
  our <a href="/legal/cancellation-policy" class="text-indigo-400 underline">Cancellation Policy</a>,
  and our general Terms of Service.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">1. ParkPeer's Role as Technology Intermediary</h3>
<p class="text-gray-300 mb-4">
  ParkPeer operates exclusively as a technology intermediary and marketplace platform. We connect
  Hosts who wish to rent parking spaces with Drivers who seek parking. ParkPeer is not a parking
  operator, landlord, insurer, or transportation company. We do not own, control, offer, or manage
  any parking space listed on the platform. All liability arising from the physical condition,
  safety, or legality of a listed space rests solely with the Host.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">2. Host Eligibility and Responsibilities</h3>
<ul class="list-disc list-inside text-gray-300 mb-4 space-y-1">
  <li>You must be at least 18 years old and legally authorized to list the space.</li>
  <li>You represent and warrant that you have all necessary rights, licenses, and permissions to
      rent the space (including landlord or HOA consent where required).</li>
  <li>You are solely responsible for ensuring the space is safe, accessible, compliant with local
      zoning and parking ordinances, and fit for the vehicle sizes you advertise.</li>
  <li>You must accurately represent the space, including dimensions, amenities, access instructions,
      and any restrictions.</li>
  <li>You must respond to booking requests within 24 hours unless Instant Book is enabled.</li>
  <li>You may not discriminate against Drivers on the basis of race, religion, national origin,
      disability, sex, gender identity, sexual orientation, or any other protected class.</li>
</ul>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">3. Fees and Payouts</h3>
<p class="text-gray-300 mb-4">
  ParkPeer charges a platform service fee of <strong class="text-white">15%</strong> of the booking
  subtotal. You will receive the remaining 85% ("Host Payout") after each completed booking,
  subject to any applicable holds, refunds, or disputes. Payouts are processed via Stripe Connect.
  You are solely responsible for any taxes owed on your rental income.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">4. Cancellation Policy</h3>
<p class="text-gray-300 mb-2">
  By listing on ParkPeer you agree to honor ParkPeer's standard cancellation policy:
</p>
<div class="overflow-x-auto mb-4">
  <table class="w-full text-sm text-gray-300 border border-white/10 rounded-xl">
    <thead>
      <tr class="bg-white/5">
        <th class="px-4 py-3 text-left font-semibold text-white">Cancellation Timing</th>
        <th class="px-4 py-3 text-left font-semibold text-white">Driver Refund</th>
        <th class="px-4 py-3 text-left font-semibold text-white">Host Receives</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-t border-white/5">
        <td class="px-4 py-3">More than 24 hours before start</td>
        <td class="px-4 py-3 text-green-400">100% full refund</td>
        <td class="px-4 py-3 text-gray-400">No payout</td>
      </tr>
      <tr class="border-t border-white/5 bg-white/2">
        <td class="px-4 py-3">2 – 24 hours before start</td>
        <td class="px-4 py-3 text-yellow-400">50% refund</td>
        <td class="px-4 py-3 text-white">50% of subtotal (minus platform fee)</td>
      </tr>
      <tr class="border-t border-white/5">
        <td class="px-4 py-3">Less than 2 hours before start</td>
        <td class="px-4 py-3 text-red-400">No refund</td>
        <td class="px-4 py-3 text-white">100% of subtotal (minus platform fee)</td>
      </tr>
    </tbody>
  </table>
</div>
<p class="text-gray-400 text-sm mb-4">
  Host-initiated cancellations will result in a full refund to the Driver plus may incur penalties
  on the Host account as determined by ParkPeer.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">5. Host Protection Program</h3>
<p class="text-gray-300 mb-4">
  ParkPeer offers basic Host Protection for documented damages caused by Drivers during a booking.
  Claims must be submitted within 72 hours of the booking end time with photographic evidence.
  ParkPeer's determination of claim eligibility and payout amounts is final. Protection does not
  cover pre-existing conditions, normal wear and tear, or losses caused by Host negligence.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">6. Account Suspension and Termination</h3>
<p class="text-gray-300 mb-4">
  ParkPeer may suspend or terminate a Host account for: repeated cancellations, falsified listing
  information, discrimination, fraud, safety violations, or breach of this Agreement. Upon
  termination all active listings will be archived and any pending payouts will be held pending
  review. Active bookings with confirmed Drivers will be honored.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">7. Limitation of Liability</h3>
<p class="text-gray-300 mb-4">
  To the maximum extent permitted by applicable law, ParkPeer's aggregate liability to any Host
  arising out of or related to this Agreement shall not exceed the total platform fees earned from
  that Host in the three (3) months preceding the claim. ParkPeer is not liable for indirect,
  incidental, special, or consequential damages.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">8. Indemnification</h3>
<p class="text-gray-300 mb-4">
  You agree to indemnify, defend, and hold harmless ParkPeer, Inc., its officers, directors,
  employees, and agents from any claims, damages, losses, liabilities, costs, and expenses
  (including reasonable legal fees) arising from: (a) your listings or spaces; (b) your violation
  of this Agreement; (c) third-party claims related to your use of the platform.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">9. Dispute Resolution and Governing Law</h3>
<p class="text-gray-300 mb-4">
  This Agreement is governed by the laws of the State of Delaware, USA, without regard to
  conflict-of-law principles. Any disputes arising under this Agreement shall be resolved by
  binding individual arbitration under the AAA Commercial Arbitration Rules. Class action
  waivers apply.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">10. Agreement Updates</h3>
<p class="text-gray-300 mb-4">
  ParkPeer may update this Agreement at any time. Hosts will be notified of material changes and
  required to re-accept before their next listing creation or booking acceptance. Continued use of
  the platform after the effective date of an update constitutes acceptance.
</p>

<p class="text-gray-400 text-xs mt-8 border-t border-white/10 pt-4">
  For questions about this Agreement, contact <a href="mailto:PARKPEER@proton.me" class="text-indigo-400 underline">PARKPEER@proton.me</a>.
  &copy; 2026 ParkPeer, Inc. All rights reserved.
</p>
`

// ── Full Cancellation Policy text ────────────────────────────────────────────
export const CANCELLATION_POLICY_TEXT = `
<h2 class="text-2xl font-bold text-white mb-2">ParkPeer Cancellation & Refund Policy</h2>
<p class="text-gray-400 text-sm mb-6">Version 1.0 &nbsp;·&nbsp; Effective January 1, 2026</p>

<p class="text-gray-300 mb-4">
  This policy governs all cancellations and refunds for bookings made through the ParkPeer platform.
  By confirming a booking you agree to the terms below.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">Driver-Initiated Cancellations</h3>
<div class="overflow-x-auto mb-4">
  <table class="w-full text-sm text-gray-300 border border-white/10 rounded-xl">
    <thead>
      <tr class="bg-white/5">
        <th class="px-4 py-3 text-left font-semibold text-white">Cancelled</th>
        <th class="px-4 py-3 text-left font-semibold text-white">Driver Refund</th>
        <th class="px-4 py-3 text-left font-semibold text-white">Platform Fee</th>
        <th class="px-4 py-3 text-left font-semibold text-white">Host Payout</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-t border-white/5">
        <td class="px-4 py-3 font-medium text-white">&gt; 24 hours before start</td>
        <td class="px-4 py-3 text-green-400 font-semibold">100%</td>
        <td class="px-4 py-3 text-gray-400">Fully refunded</td>
        <td class="px-4 py-3 text-gray-400">$0</td>
      </tr>
      <tr class="border-t border-white/5 bg-white/2">
        <td class="px-4 py-3 font-medium text-white">2 – 24 hours before start</td>
        <td class="px-4 py-3 text-yellow-400 font-semibold">50%</td>
        <td class="px-4 py-3 text-gray-400">Retained</td>
        <td class="px-4 py-3 text-white">50% of subtotal</td>
      </tr>
      <tr class="border-t border-white/5">
        <td class="px-4 py-3 font-medium text-white">&lt; 2 hours before start</td>
        <td class="px-4 py-3 text-red-400 font-semibold">No refund</td>
        <td class="px-4 py-3 text-gray-400">Retained</td>
        <td class="px-4 py-3 text-white">Full host payout</td>
      </tr>
    </tbody>
  </table>
</div>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">Host-Initiated Cancellations</h3>
<p class="text-gray-300 mb-4">
  If a Host cancels a confirmed booking for any reason, the Driver receives a <strong class="text-white">100% full refund</strong>
  regardless of timing. Repeat host cancellations may result in account penalties, reduced search
  visibility, or suspension.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">No-Show Policy</h3>
<p class="text-gray-300 mb-4">
  If a Driver fails to arrive within 30 minutes of the booking start time without cancelling, the
  booking is treated as a no-show and <strong class="text-white">no refund</strong> is issued. The Host receives
  their full payout.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">Refund Processing</h3>
<p class="text-gray-300 mb-4">
  Approved refunds are processed within <strong class="text-white">5–10 business days</strong> to the original
  payment method. ParkPeer does not control bank processing times. Refunds are issued in the
  original transaction currency (USD).
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">Disputes</h3>
<p class="text-gray-300 mb-4">
  If you believe a cancellation or refund was handled incorrectly, please contact
  <a href="mailto:PARKPEER@proton.me" class="text-indigo-400 underline">PARKPEER@proton.me</a>
  within 7 days of the booking end date. ParkPeer's decision following review is final.
</p>

<h3 class="text-lg font-semibold text-white mt-6 mb-2">Force Majeure</h3>
<p class="text-gray-300 mb-4">
  In the event of declared natural disasters, government-mandated lockdowns, or other extraordinary
  circumstances beyond the control of either party, ParkPeer may in its sole discretion issue full
  refunds regardless of the standard cancellation window.
</p>

<p class="text-gray-400 text-xs mt-8 border-t border-white/10 pt-4">
  For questions contact <a href="mailto:PARKPEER@proton.me" class="text-indigo-400 underline">PARKPEER@proton.me</a>.
  &copy; 2026 ParkPeer, Inc. All rights reserved.
</p>
`

// ── Utility: record an acceptance row in DB ──────────────────────────────────
export async function recordAcceptance(
  db: any,
  opts: {
    userId: number
    documentType: string
    version: string
    source: string
    ip?: string
    userAgent?: string
    referenceId?: number
    referenceType?: string
  }
): Promise<void> {
  const { userId, documentType, version, source, ip, userAgent, referenceId, referenceType } = opts

  await db.prepare(`
    INSERT INTO agreement_acceptances
      (user_id, document_type, document_version, acceptance_source,
       ip_address, user_agent, reference_id, reference_type, accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    userId, documentType, version, source,
    ip || null, userAgent || null,
    referenceId || null, referenceType || null
  ).run()

  // Update denormalized column on users table
  if (documentType === 'host_agreement') {
    await db.prepare(`
      UPDATE users SET host_agreement_version = ?, host_agreement_accepted_at = datetime('now')
      WHERE id = ?
    `).bind(version, userId).run()
  } else if (documentType === 'cancellation_policy') {
    await db.prepare(`
      UPDATE users SET cancel_policy_version = ?, cancel_policy_accepted_at = datetime('now')
      WHERE id = ?
    `).bind(version, userId).run()
  }

  // Clear re-accept flag if this satisfies it
  await db.prepare(`
    UPDATE users
    SET agreement_reaccept_required = CASE
      WHEN agreement_reaccept_doc = ? OR agreement_reaccept_doc = 'both' THEN
        CASE WHEN agreement_reaccept_doc = 'both' AND ? = 'host_agreement' THEN 1
             WHEN agreement_reaccept_doc = 'both' AND ? = 'cancellation_policy' THEN 1
             ELSE 0 END
      ELSE agreement_reaccept_required
    END
    WHERE id = ?
  `).bind(documentType, documentType, documentType, userId).run()
}

// ── Middleware: require agreement acceptance before protected action ───────────
export function requireAgreement(documentType: 'host_agreement' | 'cancellation_policy') {
  return async (c: any, next: any) => {
    const session = c.get('user') as any
    if (!session?.userId) {
      return c.json({ error: 'Authentication required' }, 401)
    }
    const db = c.env?.DB
    if (!db) return next()  // DB unavailable — don't block (defensive)

    const requiredVersion = CURRENT_VERSIONS[documentType]

    // Read from denormalized users column (no JOIN needed)
    const user = await db.prepare(
      'SELECT host_agreement_version, cancel_policy_version FROM users WHERE id = ?'
    ).bind(session.userId).first<any>()

    const accepted = documentType === 'host_agreement'
      ? user?.host_agreement_version
      : user?.cancel_policy_version

    if (accepted !== requiredVersion) {
      return c.json({
        error: 'You must accept the current agreement before proceeding.',
        agreement_required: true,
        document_type: documentType,
        required_version: requiredVersion,
        accepted_version: accepted || null,
      }, 403)
    }

    return next()
  }
}

// ── Hono router ──────────────────────────────────────────────────────────────
const agreementRoutes = new Hono<{ Bindings: any }>()

// ── GET /api/agreements/status — check which agreements user has accepted ─────
agreementRoutes.get('/status', requireUserAuth(), async (c) => {
  const session = c.get('user') as any
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const user = await db.prepare(`
    SELECT host_agreement_version, host_agreement_accepted_at,
           cancel_policy_version, cancel_policy_accepted_at,
           agreement_reaccept_required, agreement_reaccept_doc
    FROM users WHERE id = ?
  `).bind(session.userId).first<any>()

  return c.json({
    host_agreement: {
      accepted_version:  user?.host_agreement_version || null,
      accepted_at:       user?.host_agreement_accepted_at || null,
      required_version:  CURRENT_VERSIONS.host_agreement,
      up_to_date:        user?.host_agreement_version === CURRENT_VERSIONS.host_agreement,
    },
    cancellation_policy: {
      accepted_version:  user?.cancel_policy_version || null,
      accepted_at:       user?.cancel_policy_accepted_at || null,
      required_version:  CURRENT_VERSIONS.cancellation_policy,
      up_to_date:        user?.cancel_policy_version === CURRENT_VERSIONS.cancellation_policy,
    },
    reaccept_required: !!(user?.agreement_reaccept_required),
    reaccept_doc:      user?.agreement_reaccept_doc || null,
  })
})

// ── POST /api/agreements/accept — record acceptance ────────────────────────────
// Body: { document_type: 'host_agreement'|'cancellation_policy', version: '1.0' }
agreementRoutes.post('/accept', requireUserAuth(), async (c) => {
  const session = c.get('user') as any
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  // CSRF check
  const tokenSecret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const csrfOk = await verifyCsrf(c, tokenSecret + '.csrf')
  if (!csrfOk) return c.json({ error: 'Invalid CSRF token' }, 403)

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { document_type, version } = body
  const VALID_TYPES = ['host_agreement', 'cancellation_policy', 'terms_of_service', 'privacy_policy']
  if (!VALID_TYPES.includes(document_type)) {
    return c.json({ error: 'Invalid document_type' }, 400)
  }

  const requiredVersion = CURRENT_VERSIONS[document_type]
  const acceptedVersion = version || requiredVersion  // default to current if not supplied

  if (acceptedVersion !== requiredVersion) {
    return c.json({ error: `Version mismatch. Current version is ${requiredVersion}.` }, 409)
  }

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const ua = c.req.header('User-Agent') || ''

  try {
    await recordAcceptance(db, {
      userId:       session.userId,
      documentType: document_type,
      version:      acceptedVersion,
      source:       body.source || 'api',
      ip,
      userAgent:    ua,
      referenceId:  body.reference_id || undefined,
      referenceType: body.reference_type || undefined,
    })

    return c.json({
      success: true,
      document_type,
      version: acceptedVersion,
      accepted_at: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[POST /api/agreements/accept] Error:', e.message)
    return c.json({ error: 'Failed to record acceptance' }, 500)
  }
})

// ── GET /legal/host-agreement — full page ─────────────────────────────────────
agreementRoutes.get('/host-agreement-page', (c) => {
  const content = `
    <div class="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div class="max-w-3xl mx-auto">
        <a href="/host" class="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-8 transition-colors">
          <i class="fas fa-arrow-left"></i> Back to Dashboard
        </a>
        <div class="bg-charcoal-100 rounded-3xl p-8 border border-white/10 prose-agreement">
          ${HOST_AGREEMENT_TEXT}
        </div>
      </div>
    </div>
  `
  return c.html(Layout('Host Agreement — ParkPeer', content))
})

// ── GET /legal/cancellation-policy-page — full page ──────────────────────────
agreementRoutes.get('/cancellation-policy-page', (c) => {
  const content = `
    <div class="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div class="max-w-3xl mx-auto">
        <a href="/dashboard" class="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-8 transition-colors">
          <i class="fas fa-arrow-left"></i> Back to Dashboard
        </a>
        <div class="bg-charcoal-100 rounded-3xl p-8 border border-white/10 prose-agreement">
          ${CANCELLATION_POLICY_TEXT}
        </div>
      </div>
    </div>
  `
  return c.html(Layout('Cancellation Policy — ParkPeer', content))
})

export default agreementRoutes
