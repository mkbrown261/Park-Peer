/**
 * ParkPeer Legal Pages
 * /legal/tos           — Terms of Service
 * /legal/privacy       — Privacy Policy
 * /legal/host-protection — Host Protection Policy
 * /legal/no-bailment   — No Bailment Statement
 */

import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const legalPages = new Hono()

// ── Terms of Service ──────────────────────────────────────────────────────────
legalPages.get('/tos', (c) => {
  const content = `
  <div class="pt-24 pb-16 px-4 max-w-4xl mx-auto">
    <div class="glass rounded-3xl p-8 border border-white/10">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center">
          <i class="fas fa-file-contract text-white"></i>
        </div>
        <div>
          <h1 class="text-2xl font-black text-white">Terms of Service</h1>
          <p class="text-gray-500 text-sm">Effective: January 1, 2026 · Version 1.0</p>
        </div>
      </div>

      <div class="prose prose-invert max-w-none space-y-6 text-gray-300 text-sm leading-relaxed">

        <section>
          <h2 class="text-white font-bold text-lg mb-2">1. Acceptance of Terms</h2>
          <p>By creating an account, listing a parking space, or booking through ParkPeer, you agree to these Terms of Service ("Terms"). If you do not agree, do not use the platform.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">2. Platform Description</h2>
          <p>ParkPeer is a <strong>peer-to-peer marketplace</strong> that connects drivers looking for parking ("Drivers") with property owners who have available spaces ("Hosts"). ParkPeer is not a parking operator, does not own parking spaces, and is not a party to any parking transaction.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2 text-yellow-300">3. No Bailment Created</h2>
          <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <p class="text-yellow-200"><strong>IMPORTANT: No bailment, custody, or care of your vehicle is created by using ParkPeer.</strong> Neither ParkPeer nor any Host assumes responsibility for your vehicle, its contents, or any damages arising from its use. You park entirely at your own risk. ParkPeer is not a licensed valet, parking operator, or insurer.</p>
          </div>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">4. Liability Limitation</h2>
          <p>To the maximum extent permitted by law, ParkPeer's total liability to you for any claim arising out of or related to these Terms or the platform shall not exceed the greater of (a) the amount you paid ParkPeer in the 12 months preceding the claim, or (b) $100 USD.</p>
          <p class="mt-2">ParkPeer is not liable for: theft, vandalism, damage to your vehicle, towing, flooding, fire, or any consequential, incidental, punitive, or special damages.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">5. Indemnification</h2>
          <p>You agree to indemnify, defend, and hold harmless ParkPeer, its officers, directors, employees, and agents from and against any claims, damages, losses, and expenses (including reasonable attorneys' fees) arising from your use of the platform, violation of these Terms, or infringement of any third-party rights.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">6. Host Responsibilities</h2>
          <p>Hosts are responsible for: ensuring the legality of renting their space, maintaining safe conditions, providing accurate listing information, and complying with all applicable local laws, HOA rules, and zoning regulations. ParkPeer does not verify the legality of individual listings.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">7. Cancellation Policy</h2>
          <p><strong>Drivers:</strong> Free cancellation up to 1 hour before the booking start time. Cancellations within 1 hour are non-refundable unless the listing was materially misrepresented.</p>
          <p class="mt-1"><strong>Hosts:</strong> Free cancellation up to 24 hours before the booking start time. Host cancellations within 24 hours may result in penalties.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">8. Platform Fees</h2>
          <p>ParkPeer charges a platform service fee of approximately 15% on each booking. Hosts receive approximately 85% of the listing price. Fees are subject to change with 30 days' notice.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">9. Prohibited Uses</h2>
          <p>You may not use ParkPeer to list stolen property, conduct illegal activities, discriminate based on protected characteristics, reverse-engineer the platform, or circumvent safety measures.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">10. Dispute Resolution</h2>
          <p>Disputes between Drivers and Hosts should be reported to support@parkpeer.com. ParkPeer will attempt to mediate in good faith but is under no obligation to resolve private disputes. <strong>BINDING ARBITRATION:</strong> Any disputes between you and ParkPeer shall be resolved by binding arbitration under AAA rules, not in court.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">11. Governing Law</h2>
          <p>These Terms are governed by the laws of the State of Delaware, USA, without regard to conflict of law principles.</p>
        </section>

        <p class="text-gray-500 text-xs">Questions? Email legal@parkpeer.com · ParkPeer, Inc. · © 2026</p>
      </div>
    </div>
  </div>
  `
  return c.html(Layout('Terms of Service — ParkPeer', content))
})

// ── Privacy Policy ────────────────────────────────────────────────────────────
legalPages.get('/privacy', (c) => {
  const content = `
  <div class="pt-24 pb-16 px-4 max-w-4xl mx-auto">
    <div class="glass rounded-3xl p-8 border border-white/10">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center">
          <i class="fas fa-shield-halved text-white"></i>
        </div>
        <div>
          <h1 class="text-2xl font-black text-white">Privacy Policy</h1>
          <p class="text-gray-500 text-sm">Effective: January 1, 2026 · Version 1.0</p>
        </div>
      </div>

      <div class="prose prose-invert max-w-none space-y-6 text-gray-300 text-sm leading-relaxed">

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Data We Collect</h2>
          <ul class="list-disc list-inside space-y-1">
            <li><strong>Account data:</strong> Name, email, phone number, profile photo</li>
            <li><strong>Payment data:</strong> Stripe processes all payments. ParkPeer stores only the last-4 digits of cards and Stripe customer IDs — never full card numbers.</li>
            <li><strong>Payout data:</strong> Bank account and routing numbers are encrypted using AES-256-GCM before storage. Only last-4 digits are stored unencrypted.</li>
            <li><strong>Location data:</strong> Listing addresses and search queries</li>
            <li><strong>Usage data:</strong> Pages visited, features used, device type</li>
          </ul>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Data Retention</h2>
          <ul class="list-disc list-inside space-y-1">
            <li>Unverified accounts inactive for 30+ days are automatically deleted</li>
            <li>Transaction records are retained for 7 years for financial compliance, then anonymized</li>
            <li>You may request deletion of your account at any time via support@parkpeer.com</li>
          </ul>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Security</h2>
          <p>Passwords are hashed using PBKDF2-SHA256 (310,000 iterations). Sensitive financial data is encrypted with AES-256-GCM. All data is transmitted over TLS 1.3. We apply HSTS, CSP, and OWASP security headers on all responses.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Your Rights (GDPR / CCPA)</h2>
          <p>You have the right to access, correct, delete, or export your personal data. Contact privacy@parkpeer.com. We do not sell personal data to third parties.</p>
        </section>

        <p class="text-gray-500 text-xs">Questions? Email privacy@parkpeer.com · ParkPeer, Inc. · © 2026</p>
      </div>
    </div>
  </div>
  `
  return c.html(Layout('Privacy Policy — ParkPeer', content))
})

// ── Host Protection Policy ────────────────────────────────────────────────────
legalPages.get('/host-protection', (c) => {
  const content = `
  <div class="pt-24 pb-16 px-4 max-w-4xl mx-auto">
    <div class="glass rounded-3xl p-8 border border-white/10">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 bg-lime-500/20 rounded-xl flex items-center justify-center">
          <i class="fas fa-house-circle-check text-lime-400"></i>
        </div>
        <div>
          <h1 class="text-2xl font-black text-white">Host Protection Policy</h1>
          <p class="text-gray-500 text-sm">Effective: January 1, 2026 · Version 1.0</p>
        </div>
      </div>

      <div class="prose prose-invert max-w-none space-y-6 text-gray-300 text-sm leading-relaxed">

        <div class="bg-lime-500/10 border border-lime-500/30 rounded-xl p-4 mb-6">
          <p class="text-lime-200 font-medium"><i class="fas fa-circle-info mr-2"></i>ParkPeer's Host Protection Policy is a goodwill program — it is <strong>not an insurance policy</strong> and does not replace your own insurance coverage.</p>
        </div>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">What We Cover (Goodwill Basis)</h2>
          <p>In the event a Driver causes verified property damage to your listed space during a confirmed ParkPeer booking, ParkPeer may, at its sole discretion, provide reimbursement assistance of up to <strong>$500 per incident</strong> after deductible and after the Driver has been billed. This is not guaranteed and subject to claim review.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">What Is NOT Covered</h2>
          <ul class="list-disc list-inside space-y-1">
            <li>Pre-existing damage</li>
            <li>Normal wear and tear</li>
            <li>Vehicle damage (the driver's vehicle)</li>
            <li>Loss of income during repairs</li>
            <li>Claims without photographic evidence submitted within 24 hours</li>
            <li>Damage caused by weather, acts of God, or third parties</li>
          </ul>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Filing a Claim</h2>
          <ol class="list-decimal list-inside space-y-1">
            <li>Document damage with timestamped photos within 24 hours</li>
            <li>Submit a claim via your Host Dashboard → Protection Claims</li>
            <li>ParkPeer reviews within 5 business days</li>
            <li>If approved, reimbursement is issued via Stripe within 7 business days</li>
          </ol>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Recommendation</h2>
          <p>We strongly recommend Hosts carry their own property and liability insurance. ParkPeer is not an insurance company and this policy does not satisfy any insurance requirements.</p>
        </section>

        <p class="text-gray-500 text-xs">Questions? Email hosts@parkpeer.com · ParkPeer, Inc. · © 2026</p>
      </div>
    </div>
  </div>
  `
  return c.html(Layout('Host Protection Policy — ParkPeer', content))
})

// ── No-Bailment Statement ─────────────────────────────────────────────────────
legalPages.get('/no-bailment', (c) => {
  const content = `
  <div class="pt-24 pb-16 px-4 max-w-4xl mx-auto">
    <div class="glass rounded-3xl p-8 border border-white/10">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 bg-yellow-500/20 rounded-xl flex items-center justify-center">
          <i class="fas fa-triangle-exclamation text-yellow-400"></i>
        </div>
        <div>
          <h1 class="text-2xl font-black text-white">No Bailment Statement</h1>
          <p class="text-gray-500 text-sm">Effective: January 1, 2026</p>
        </div>
      </div>

      <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6 mb-6">
        <p class="text-yellow-200 text-base leading-relaxed">
          <strong>USE OF PARKPEER DOES NOT CREATE A BAILMENT.</strong> Neither ParkPeer, Inc. nor any Host using the ParkPeer platform takes possession, custody, or control of your vehicle or its contents at any time. No bailment relationship, express or implied, is created by listing, booking, or parking through ParkPeer.
        </p>
      </div>

      <div class="prose prose-invert max-w-none space-y-6 text-gray-300 text-sm leading-relaxed">
        <section>
          <h2 class="text-white font-bold text-lg mb-2">What This Means</h2>
          <p>In a traditional parking garage or valet arrangement, a "bailment" is created — the parking operator takes legal possession of your vehicle and assumes a duty of care. ParkPeer operates differently: we are a technology marketplace connecting property owners with drivers. The Host merely grants a license to use a defined area. At no point does any party accept responsibility for your vehicle.</p>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">You Park At Your Own Risk</h2>
          <ul class="list-disc list-inside space-y-1">
            <li>ParkPeer is not liable for vehicle theft, break-ins, or vandalism</li>
            <li>ParkPeer is not liable for damage caused by weather, flooding, or fire</li>
            <li>ParkPeer is not liable for towing, impoundment, or ticketing</li>
            <li>ParkPeer is not liable for damage to your vehicle's contents</li>
          </ul>
        </section>

        <section>
          <h2 class="text-white font-bold text-lg mb-2">Recommendations</h2>
          <p>We recommend verifying your auto insurance covers off-premise parking incidents. Always lock your vehicle and never leave valuables visible.</p>
        </section>

        <p class="text-gray-500 text-xs">Questions? Email legal@parkpeer.com · ParkPeer, Inc. · © 2026</p>
      </div>
    </div>
  </div>
  `
  return c.html(Layout('No Bailment Statement — ParkPeer', content))
})
