import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { verifyUserToken } from '../middleware/security'

type Bindings = { USER_TOKEN_SECRET: string }

export const bookingPage = new Hono<{ Bindings: Bindings }>()

bookingPage.get('/:id', async (c) => {
  const id = c.req.param('id')

  // ── Auth guard: require login to access checkout ──────────────────────────
  const session = await verifyUserToken(
    c,
    c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  ).catch(() => null)
  if (!session) {
    return c.redirect(`/auth/login?reason=auth&next=${encodeURIComponent('/booking/' + id)}`)
  }
  const navSession = { name: session.name || session.email || '', role: session.role || '' }

  const content = `
  <style>
    /* ══════════════════════════════════════════════════
       ParkPeer — Custom Time-Based Booking Picker Styles
       ══════════════════════════════════════════════════ */

    /* ── Scrollbar ──────────────────────────────────── */
    .pp-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
    .pp-scroll::-webkit-scrollbar-track { background: #1e1e2e; }
    .pp-scroll::-webkit-scrollbar-thumb { background: #4f46e5; border-radius: 4px; }
    .pp-scroll { scrollbar-width: thin; scrollbar-color: #4f46e5 #1e1e2e; }

    /* ── Date strip ─────────────────────────────────── */
    .date-strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x mandatory; }
    .date-strip::-webkit-scrollbar { height: 3px; }
    .date-strip::-webkit-scrollbar-track { background: transparent; }
    .date-strip::-webkit-scrollbar-thumb { background: #4f46e5; border-radius: 4px; }

    .date-btn {
      flex-shrink: 0; scroll-snap-align: start;
      min-width: 56px; padding: 10px 8px;
      border-radius: 12px; border: 1.5px solid rgba(255,255,255,.07);
      background: #1e1e2e; color: #9ca3af;
      font-size: 11px; font-weight: 600; text-align: center;
      cursor: pointer; transition: all .15s;
      -webkit-tap-highlight-color: transparent;
    }
    .date-btn:hover:not([disabled]) { border-color: #6366f1; color: #a5b4fc; }
    .date-btn.selected { background: #4f46e5; border-color: #6366f1; color: #fff; box-shadow: 0 0 0 2px rgba(99,102,241,.3); }
    .date-btn[disabled] { background: #111827; color: #374151; border-color: transparent; cursor: not-allowed; }
    .date-btn .date-dot { width: 5px; height: 5px; border-radius: 50%; margin: 3px auto 0; }
    .date-btn .date-dot.avail   { background: #22c55e; }
    .date-btn .date-dot.partial { background: #f59e0b; }
    .date-btn .date-dot.closed  { background: #374151; }

    /* ── Section cards ──────────────────────────────── */
    .picker-card {
      background: #12121e;
      border: 1.5px solid rgba(255,255,255,.07);
      border-radius: 14px; padding: 14px;
    }
    .picker-card:focus-within { border-color: rgba(99,102,241,.4); }

    .picker-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin-bottom: 6px; }
    .picker-value { font-size: 15px; font-weight: 700; color: #fff; line-height: 1.2; }
    .picker-value.placeholder { color: #4b5563; font-weight: 400; font-size: 13px; }

    /* ── Time grid ──────────────────────────────────── */
    .time-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
      max-height: 240px; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: #4f46e5 #1e1e2e;
    }
    .time-grid::-webkit-scrollbar { width: 4px; }
    .time-grid::-webkit-scrollbar-track { background: #1e1e2e; }
    .time-grid::-webkit-scrollbar-thumb { background: #4f46e5; border-radius: 4px; }

    .slot-btn {
      padding: 8px 4px;
      border-radius: 9px; font-size: 11px; font-weight: 600;
      border: 1.5px solid transparent; cursor: pointer;
      transition: all .12s; text-align: center;
      background: #1e1e2e; color: #9ca3af;
      -webkit-tap-highlight-color: transparent;
      min-height: 36px;
    }
    .slot-btn:hover:not([disabled]) { background: #4f46e5; color: #fff; border-color: #6366f1; }
    .slot-btn.selected    { background: #4f46e5; color: #fff; border-color: #818cf8; box-shadow: 0 0 0 2px rgba(99,102,241,.4); }
    .slot-btn.in-range    { background: rgba(79,70,229,.18); color: #c7d2fe; border-color: rgba(99,102,241,.25); }
    .slot-btn.booked      { background: #200d0d; color: #f87171; border-color: rgba(127,29,29,.5); cursor: not-allowed; }
    .slot-btn.booked::after { content: '✕'; margin-left: 2px; font-size: 9px; }
    .slot-btn.held        { background: #1e1400; color: #fbbf24; border-color: rgba(120,53,15,.5); cursor: not-allowed; }
    .slot-btn.closed      { background: #0e0e1a; color: #374151; cursor: not-allowed; }
    .slot-btn.past        { background: #0a0a12; color: #1f2937; cursor: not-allowed; }

    /* ── Suggestions chips ──────────────────────────── */
    .suggestion-chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 12px; border-radius: 20px;
      background: rgba(99,102,241,.1); border: 1.5px solid rgba(99,102,241,.25);
      color: #a5b4fc; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s; white-space: nowrap;
      -webkit-tap-highlight-color: transparent;
    }
    .suggestion-chip:hover, .suggestion-chip:active { background: rgba(99,102,241,.25); border-color: #6366f1; color: #fff; }

    /* ── Validation banner ──────────────────────────── */
    .validation-banner {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 14px; border-radius: 12px;
      font-size: 13px; line-height: 1.4;
    }
    .validation-banner.checking { background: rgba(99,102,241,.08); border: 1px solid rgba(99,102,241,.2); color: #a5b4fc; }
    .validation-banner.valid    { background: rgba(34,197,94,.08);  border: 1px solid rgba(34,197,94,.2);  color: #86efac; }
    .validation-banner.error    { background: rgba(239,68,68,.08);  border: 1px solid rgba(239,68,68,.2);  color: #fca5a5; }

    /* ── Duration summary bar ───────────────────────── */
    .duration-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-radius: 14px;
      background: rgba(79,70,229,.08); border: 1.5px solid rgba(99,102,241,.2);
      margin-top: 12px;
    }

    /* ── Shimmer loader ─────────────────────────────── */
    @keyframes shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      20%     { transform: translateX(-6px); }
      40%     { transform: translateX(6px); }
      60%     { transform: translateX(-4px); }
      80%     { transform: translateX(4px); }
    }
    .shimmer {
      background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3e 50%, #1e1e2e 75%);
      background-size: 200% 100%; animation: shimmer 1.2s infinite; border-radius: 10px;
    }

    /* ── Multi-day end-date panel ───────────────────── */
    #end-date-row { transition: all .2s; }

    /* ── Responsive tweaks ──────────────────────────── */
    @media (max-width: 480px) {
      .time-grid { grid-template-columns: repeat(3, 1fr); }
      .slot-btn  { font-size: 12px; padding: 10px 4px; min-height: 42px; }
      .date-btn  { min-width: 52px; padding: 9px 6px; }
    }
    @media (min-width: 640px) {
      .time-grid { grid-template-columns: repeat(6, 1fr); }
    }
  </style>

  <div class="pt-16 min-h-screen">
    <div class="max-w-4xl mx-auto px-4 py-8">

      <!-- Breadcrumb -->
      <div class="flex items-center gap-2 text-sm text-gray-500 mb-6 flex-wrap">
        <a href="/" class="hover:text-white">Home</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <a href="/search" class="hover:text-white">Search</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <a href="/listing/${id}" class="hover:text-white">Listing</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <span class="text-gray-300">Checkout</span>
      </div>

      <!-- Progress steps -->
      <div class="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        ${['Select Time','Review & Pay','Confirmation'].map((step, i) => `
          <div class="flex items-center gap-2 flex-shrink-0">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full ${i===1?'gradient-bg text-white':i<1?'bg-green-500 text-white':'bg-charcoal-200 text-gray-500'} flex items-center justify-center text-xs font-bold">
                ${i<1?'<i class="fas fa-check text-xs"></i>':i+1}
              </div>
              <span class="text-sm font-medium ${i===1?'text-white':i<1?'text-green-400':'text-gray-500'}">${step}</span>
            </div>
            ${i<2?'<div class="w-12 h-px bg-white/10"></div>':''}
          </div>
        `).join('')}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-6">

        <!-- ════ Main Checkout Form ════ -->
        <div class="md:col-span-3 space-y-5">

          <!-- ══ Parking Window ══ -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h2 class="font-bold text-white text-lg mb-5 flex items-center gap-2">
              <i class="fas fa-clock text-indigo-400"></i>Parking Window
            </h2>

            <!-- ── Start Date strip ──────────────────────── -->
            <div class="mb-4">
              <p class="picker-label">Arrival Date</p>
              <div id="date-strip" class="date-strip pp-scroll">
                <div class="shimmer h-16 w-full rounded-xl"></div>
              </div>
            </div>

            <!-- ── Start time picker ─────────────────────── -->
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div>
                <p class="picker-label">Start Time</p>
                <button id="start-picker-btn" onclick="toggleTimePicker('start')"
                  class="picker-card w-full text-left hover:border-indigo-500/40 transition-colors">
                  <div id="start-display" class="picker-value placeholder">— Tap to choose time —</div>
                </button>
              </div>
              <div>
                <p class="picker-label">End Time</p>
                <button id="end-picker-btn" onclick="toggleTimePicker('end')"
                  class="picker-card w-full text-left hover:border-indigo-500/40 transition-colors" disabled>
                  <div id="end-display" class="picker-value placeholder">— Select start first —</div>
                </button>
              </div>
            </div>

            <!-- ── Multi-day: end date strip (hidden until needed) ── -->
            <div id="end-date-row" class="hidden mb-4">
              <p class="picker-label flex items-center gap-1.5">
                <i class="fas fa-calendar-days text-indigo-400"></i>
                End Date <span class="text-indigo-400 ml-1">(multi-day)</span>
              </p>
              <div id="end-date-strip" class="date-strip pp-scroll"></div>
            </div>

            <!-- ── Time grid popup ───────────────────────── -->
            <div id="time-picker-popup" class="hidden mb-4">
              <div class="picker-card">
                <div class="flex items-center justify-between mb-3">
                  <p class="text-sm font-semibold text-white" id="picker-title">Select Start Time</p>
                  <button onclick="closeTimePicker()"
                    class="text-gray-500 hover:text-white text-xs px-3 py-1.5 bg-charcoal-200 rounded-lg transition-colors">
                    ✕ Close
                  </button>
                </div>
                <div id="picker-loading" class="shimmer h-32 rounded-xl"></div>
                <div id="time-grid" class="time-grid hidden"></div>
                <!-- Legend -->
                <div class="flex flex-wrap gap-3 mt-3 pt-3 border-t border-white/5">
                  <span class="flex items-center gap-1.5 text-xs text-gray-500"><span class="w-3 h-3 rounded-sm bg-indigo-600 inline-block"></span>Available</span>
                  <span class="flex items-center gap-1.5 text-xs text-gray-500"><span class="w-3 h-3 rounded-sm bg-indigo-500/20 border border-indigo-500/30 inline-block"></span>In range</span>
                  <span class="flex items-center gap-1.5 text-xs text-gray-500"><span class="w-3 h-3 rounded-sm bg-red-900/60 inline-block"></span>Booked</span>
                  <span class="flex items-center gap-1.5 text-xs text-gray-500"><span class="w-3 h-3 rounded-sm bg-yellow-900/60 inline-block"></span>Held</span>
                  <span class="flex items-center gap-1.5 text-xs text-gray-500"><span class="w-3 h-3 rounded-sm bg-gray-800 inline-block"></span>Closed</span>
                </div>
              </div>
            </div>

            <!-- ── Quick duration chips ───────────────────── -->
            <div id="suggestions-row" class="hidden mb-4">
              <p class="picker-label mb-2">Quick Duration</p>
              <div id="suggestions-chips" class="flex flex-wrap gap-2"></div>
            </div>

            <!-- ── Validation banner ─────────────────────── -->
            <div id="validation-banner" class="hidden validation-banner">
              <i id="validation-icon" class="fas fa-spinner fa-spin mt-0.5 flex-shrink-0"></i>
              <span id="validation-msg"></span>
            </div>

            <!-- ── Duration / pricing bar ────────────────── -->
            <div id="duration-summary" class="hidden duration-bar">
              <div class="flex items-center gap-3">
                <i class="fas fa-hourglass-half text-indigo-400 text-sm"></i>
                <div>
                  <p class="text-white text-sm font-semibold" id="dur-label">—</p>
                  <p class="text-gray-500 text-xs" id="dur-sublabel">—</p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-indigo-300 text-xs">Est. total</p>
                <p class="text-white font-bold text-base" id="dur-total">—</p>
              </div>
            </div>

            <!-- Hidden ISO inputs consumed by payment flow -->
            <input type="hidden" id="booking-arrive" />
            <input type="hidden" id="booking-depart" />
          </div>

          <!-- ══ Vehicle Information ══ -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-car text-indigo-400"></i>Your Vehicle
            </h2>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-xs text-gray-500 block mb-1.5">Make &amp; Model</label>
                  <input type="text" id="vehicle-make" placeholder="e.g. Toyota Camry"
                    class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
                </div>
                <div>
                  <label class="text-xs text-gray-500 block mb-1.5">License Plate</label>
                  <input type="text" id="vehicle-plate" placeholder="e.g. ABC 1234"
                    class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
                </div>
              </div>
              <div>
                <label class="text-xs text-gray-500 block mb-1.5">Vehicle Size</label>
                <div class="grid grid-cols-3 gap-2">
                  ${[{s:'Compact',e:'🚗'},{s:'Sedan/SUV',e:'🚙'},{s:'Truck/Van',e:'🛻'}].map((v,i) => `
                    <button onclick="selectVehicle(this)"
                      class="vehicle-btn p-3 rounded-xl border text-center transition-all ${i===0?'border-indigo-500 bg-indigo-500/10':'border-white/5 bg-charcoal-200 hover:border-indigo-500/50'}">
                      <span class="text-xl block">${v.e}</span>
                      <span class="text-xs text-gray-300 mt-1">${v.s}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <!-- ══ OTP Verification Modal ══ -->
          <div id="otp-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 hidden" style="background:rgba(0,0,0,.75);backdrop-filter:blur(4px)">
            <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
              <div class="flex items-center justify-between mb-5">
                <div>
                  <h3 class="font-bold text-white text-lg" id="otp-modal-title">Verify your contact</h3>
                  <p class="text-gray-400 text-sm mt-0.5" id="otp-modal-subtitle">Enter the 6-digit code we sent</p>
                </div>
                <button onclick="closeOtpModal()" class="text-gray-500 hover:text-white transition-colors p-1">
                  <i class="fas fa-xmark text-lg"></i>
                </button>
              </div>
              <div class="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2">
                <i id="otp-modal-icon" class="fas fa-envelope text-indigo-400 text-sm"></i>
                <span id="otp-modal-dest" class="text-white text-sm font-mono"></span>
              </div>
              <div class="flex gap-2 justify-center mb-4" id="otp-digit-row"></div>
              <p id="otp-error-msg" class="text-red-400 text-xs text-center mb-3 hidden"></p>
              <p id="otp-success-msg" class="text-green-400 text-xs text-center mb-3 hidden"></p>
              <button id="otp-verify-btn" onclick="submitOtpCode()" disabled
                class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 rounded-xl transition-colors mb-3">
                <i class="fas fa-check mr-1.5"></i>Verify Code
              </button>
              <div class="flex items-center justify-between">
                <button id="otp-resend-btn" onclick="resendOtpCode()" class="text-indigo-400 hover:text-indigo-300 text-xs transition-colors">
                  <i class="fas fa-rotate-right mr-1"></i>Resend code
                </button>
                <span id="otp-resend-timer" class="text-gray-500 text-xs hidden"></span>
              </div>
            </div>
          </div>

          <!-- ══ Contact Info ══ -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-user text-indigo-400"></i>Your Info
            </h2>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-500 block mb-1.5">First Name</label>
                <input type="text" id="contact-first" placeholder="First name"
                  autocomplete="given-name"
                  class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
              </div>
              <div>
                <label class="text-xs text-gray-500 block mb-1.5">Last Name</label>
                <input type="text" id="contact-last" placeholder="Last name"
                  autocomplete="family-name"
                  class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
              </div>

              <!-- Email with inline verification -->
              <div class="col-span-2">
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-xs text-gray-500">Email <span class="text-gray-600">(confirmation + QR code)</span></label>
                  <span id="email-verify-badge" class="hidden text-xs font-semibold px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-700/40">
                    <i class="fas fa-check-circle mr-1"></i>Verified
                  </span>
                </div>
                <div class="relative">
                  <input type="email" id="contact-email" placeholder="you@example.com"
                    autocomplete="email" maxlength="254"
                    list="email-suggestions"
                    oninput="onEmailInput()"
                    class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 pr-24"/>
                  <datalist id="email-suggestions"></datalist>
                  <button id="email-verify-btn" onclick="startEmailVerify()" type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-600/80 text-white hover:bg-indigo-500 transition-colors hidden">
                    Verify →
                  </button>
                </div>
                <p id="email-hint" class="text-xs mt-1 hidden"></p>
              </div>

              <!-- Phone with inline verification -->
              <div class="col-span-2">
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-xs text-gray-500">Phone <span class="text-gray-600">(SMS with QR check-in link — optional)</span></label>
                  <span id="phone-verify-badge" class="hidden text-xs font-semibold px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-700/40">
                    <i class="fas fa-check-circle mr-1"></i>Verified
                  </span>
                </div>
                <div class="relative">
                  <input type="tel" id="contact-phone" placeholder="5551234567 or +442071234567"
                    autocomplete="tel" maxlength="20"
                    oninput="onPhoneInput()"
                    class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 pr-24"/>
                  <button id="phone-verify-btn" onclick="startPhoneVerify()" type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-600/80 text-white hover:bg-indigo-500 transition-colors hidden">
                    Verify →
                  </button>
                </div>
                <p id="phone-hint" class="text-xs mt-1 hidden"></p>
              </div>
            </div>
          </div>

          <!-- ══ Payment ══ -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-credit-card text-indigo-400"></i>Payment
            </h2>
            <button onclick="toggleNewCard()" id="add-card-btn"
              class="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-white/20 rounded-xl text-gray-400 hover:text-white hover:border-white/40 transition-colors text-sm">
              <i class="fas fa-plus"></i> Add Card
            </button>
            <div id="new-card-form" class="hidden mt-3 space-y-2">
              <!-- Hold countdown -->
              <div id="hold-countdown" class="hidden text-xs font-semibold text-indigo-300 bg-indigo-900/25 border border-indigo-500/25 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <i class="fas fa-lock text-indigo-400"></i>
                <span id="hold-countdown-text">Slot reserved…</span>
              </div>
              <!-- Stripe Payment Element -->
              <div id="stripe-payment-element" class="bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3"></div>
              <div id="stripe-card-errors" class="text-red-400 text-xs mt-1 hidden"></div>
              <p class="text-xs text-gray-500 mt-1">
                <i class="fas fa-lock mr-1 text-green-400"></i>Secured by Stripe · 256-bit SSL · Slot held 10 min
              </p>
            </div>
          </div>

          <!-- ══ Notes to Host ══ -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h2 class="font-bold text-white text-lg mb-3 flex items-center gap-2">
              <i class="fas fa-message text-indigo-400"></i>Message to Host
              <span class="text-gray-500 font-normal text-sm">(Optional)</span>
            </h2>
            <textarea id="host-message" placeholder="Let the host know anything helpful about your arrival"
              rows="3"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"></textarea>
          </div>

          <!-- No Bailment disclaimer -->
          <div class="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
            <p class="text-xs text-yellow-300/80 leading-relaxed">
              <i class="fas fa-triangle-exclamation mr-1"></i>
              <strong>No Bailment:</strong> ParkPeer and the Host do not take custody of your vehicle. You park at your own risk.
              <a href="/legal/no-bailment" target="_blank" class="text-yellow-400 hover:underline ml-1">Learn more</a>
            </p>
          </div>

          <!-- Terms -->
          <label class="flex items-start gap-3 cursor-pointer group" id="terms-check-label">
            <input type="checkbox" id="terms-check"
              class="mt-1 accent-indigo-500 w-4 h-4 flex-shrink-0"
              onchange="updateConfirmBtn()"/>
            <p class="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
              I agree to ParkPeer's
              <a href="/legal/tos" class="text-indigo-400 hover:underline">Terms of Service</a>,
              <a href="/legal/privacy" class="text-indigo-400 hover:underline">Privacy Policy</a>,
              and understand the
              <a href="/legal/tos#cancellation" class="text-indigo-400 hover:underline">Cancellation Policy</a>.
            </p>
          </label>
        </div>

        <!-- ════ Order Summary Sidebar ════ -->
        <div class="md:col-span-2">
          <div class="sticky top-20 space-y-4">

            <!-- Listing card -->
            <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-5" id="listing-summary">
              <div class="flex gap-3 mb-4 pb-4 border-b border-white/5">
                <div class="w-16 h-16 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center flex-shrink-0">
                  <i class="fas fa-warehouse text-white/20 text-2xl" id="listing-icon"></i>
                </div>
                <div>
                  <p class="font-bold text-white text-sm leading-tight" id="listing-title">Loading…</p>
                  <p class="text-gray-500 text-xs mt-1 flex items-center gap-1">
                    <i class="fas fa-map-pin text-indigo-400"></i>
                    <span id="listing-address">—</span>
                  </p>
                  <div class="flex items-center gap-1 mt-1">
                    <i class="fas fa-star text-amber-400 text-xs"></i>
                    <span class="text-white text-xs" id="listing-rating">—</span>
                    <span class="text-gray-500 text-xs" id="listing-reviews"></span>
                  </div>
                </div>
              </div>

              <!-- Price breakdown -->
              <div class="space-y-2.5 text-sm" id="price-rows">
                <div class="flex justify-between text-gray-300">
                  <span id="rate-label">Rate × hours</span>
                  <span id="base-amount">—</span>
                </div>
                <div class="flex justify-between text-gray-300">
                  <span class="flex items-center gap-1">
                    Service fee
                    <i class="fas fa-circle-info text-gray-500 text-xs cursor-help" title="Covers payment processing, insurance &amp; 24/7 support"></i>
                  </span>
                  <span id="fee-amount">—</span>
                </div>
                <div class="border-t border-white/10 pt-2.5 flex justify-between font-bold text-white text-base">
                  <span>Total</span>
                  <span id="total-amount">—</span>
                </div>
              </div>

              <!-- Host schedule preview -->
              <div id="host-schedule-preview" class="mt-4 hidden">
                <p class="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                  <i class="fas fa-calendar-days text-indigo-400"></i> Host Hours
                </p>
                <div id="schedule-rows" class="space-y-1"></div>
              </div>

              <!-- Cancellation policy -->
              <div class="mt-4 p-4 bg-charcoal-200 border border-white/10 rounded-xl">
                <p class="text-white text-xs font-semibold flex items-center gap-2 mb-3">
                  <i class="fas fa-calendar-xmark text-green-400"></i>
                  Cancellation &amp; Refund Policy
                </p>
                <table class="w-full text-xs text-gray-400 mb-3">
                  <tbody>
                    <tr><td class="py-0.5 pr-2">&gt; 24 hrs before</td><td class="text-green-400 font-semibold">Full refund</td></tr>
                    <tr><td class="py-0.5 pr-2">2 – 24 hrs before</td><td class="text-yellow-400 font-semibold">50% refund</td></tr>
                    <tr><td class="py-0.5 pr-2">&lt; 2 hrs before</td><td class="text-red-400 font-semibold">No refund</td></tr>
                  </tbody>
                </table>
                <label class="flex items-start gap-2.5 cursor-pointer select-none" id="cancel-ack-label">
                  <input type="checkbox" id="cancel-ack-checkbox"
                    class="mt-0.5 w-4 h-4 accent-indigo-500 rounded cursor-pointer flex-shrink-0"
                    onchange="updateConfirmBtn()"/>
                  <span class="text-gray-400 text-xs leading-relaxed">
                    I understand the
                    <a href="/legal/cancellation-policy" target="_blank" class="text-indigo-400 hover:underline">ParkPeer Cancellation Policy</a>.
                  </span>
                </label>
              </div>
            </div>

            <!-- CTA Button -->
            <button onclick="confirmBooking()"
              class="btn-primary w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-white text-lg transition-all opacity-60"
              id="confirm-btn" disabled>
              <i class="fas fa-lock" id="confirm-icon"></i>
              <span id="confirm-label">Select a time first</span>
            </button>
            <p class="text-center text-gray-500 text-xs">
              <i class="fas fa-shield-halved text-green-400 mr-1"></i>
              Secured by Stripe · 256-bit SSL
            </p>

            <!-- What happens next -->
            <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-4">
              <h4 class="text-white font-semibold text-sm mb-3">What happens next?</h4>
              <div class="space-y-2.5">
                ${[
                  { icon:'fa-envelope',     text:'Instant confirmation email',   time:'Now' },
                  { icon:'fa-qrcode',        text:'QR check-in code delivered',   time:'1 min' },
                  { icon:'fa-map-location',  text:'Directions &amp; access code', time:'1 min' },
                  { icon:'fa-message',       text:'Host notified automatically',  time:'1 min' },
                ].map(s => `
                  <div class="flex items-center gap-3">
                    <div class="w-7 h-7 bg-indigo-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <i class="fas ${s.icon} text-indigo-400 text-xs"></i>
                    </div>
                    <span class="text-gray-400 text-xs flex-1">${s.text}</span>
                    <span class="text-gray-600 text-xs">${s.time}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Success Modal ─────────────────────────────── -->
  <div id="success-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-sm border border-white/10 p-8 text-center">
      <div class="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-check text-green-400 text-3xl"></i>
      </div>
      <h2 class="text-2xl font-black text-white mb-2">Booking Confirmed!</h2>
      <p class="text-gray-400 mb-4">Your QR code and directions have been sent to your phone and email.</p>
      <div class="bg-charcoal-200 rounded-2xl p-4 mb-5">
        <p class="text-indigo-300 text-xs mb-1">Booking Reference</p>
        <p class="text-white font-black text-2xl tracking-wider" id="success-booking-ref">PP-2024-0001</p>
        <p class="text-gray-400 text-sm mt-2" id="success-time"></p>
        <p class="text-gray-500 text-xs mt-1" id="success-address"></p>
      </div>
      <div class="flex gap-3">
        <button id="view-booking-btn" onclick="viewBookingAfterConfirm()"
          class="flex-1 py-3 btn-primary text-white rounded-xl font-semibold text-sm">
          View Booking
        </button>
        <button onclick="document.getElementById('success-modal').classList.add('hidden')"
          class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white">
          Close
        </button>
      </div>
    </div>
  </div>

  <script src="https://js.stripe.com/v3/"></script>
  <script>
  // ════════════════════════════════════════════════════════════════════════════
  // ParkPeer — Time-Based Booking System v2
  //
  // Flow:
  //   1. loadListing()  — fetch listing + host schedule + build date strip
  //   2. selectDate()   — pick arrival date, auto-open start-time picker
  //   3. openTimePicker('start') — fetch slots for date, render 15-min grid
  //   4. selectTimeSlot(slot,'start') — lock start, auto-open end picker
  //      • also shows Quick Duration chips (+1h, +2h, +3h, +4h)
  //      • if end time would cross midnight → show end-date strip
  //   5. selectTimeSlot(slot,'end') — build ISO datetimes, call validateSlot
  //   6. validateSlot() — POST /api/listings/:id/validate-slot (server-side)
  //      • returns pricing object if valid
  //   7. confirmBooking() — check terms, acquire hold, init Stripe, pay
  //      • POST /api/holds → hold_id + session_token + expires_at
  //      • POST /api/payments/create-intent → clientSecret
  //      • stripe.confirmPayment()
  //      • POST /api/payments/confirm → booking reference
  // ════════════════════════════════════════════════════════════════════════════

  const LISTING_ID    = '${id}';
  let listingData     = null;
  let hostSchedule    = null;   // [{day_of_week, is_available, open_time, close_time}]
  let slotCache       = {};     // "YYYY-MM-DD" → slots[]

  // ── Selected state ────────────────────────────────────────────────────────
  let selectedStartDate = null;   // 'YYYY-MM-DD'
  let selectedEndDate   = null;   // 'YYYY-MM-DD' (same as start for same-day, or next day+)
  let selectedStartSlot = null;   // { time:'HH:MM', iso, status }
  let selectedEndSlot   = null;   // { time:'HH:MM', iso, status }
  let activePickerMode  = null;   // 'start' | 'end'
  let isMultiDay        = false;

  // ── Stripe / hold state ───────────────────────────────────────────────────
  let stripe           = null;
  let stripeElements   = null;
  let paymentElement   = null;
  let stripeReady      = false;
  let dbBookingId      = null;
  const checkoutToken  = ([1e7]+-1e3+-4e3+-8e3+-1e11)
    .replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
  let holdId           = null;
  let holdSessionToken = null;
  let holdExpiresAt    = null;
  let holdCountdownTimer = null;

  // ── Validation ────────────────────────────────────────────────────────────
  let validationTimer  = null;
  let lastValidResult  = null;   // cached pricing from validate-slot

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  function fmt12(timeStr) {
    if (!timeStr) return '—';
    const [hh, mm] = timeStr.split(':').map(Number);
    const period = hh < 12 ? 'AM' : 'PM';
    const h12    = hh % 12 || 12;
    return h12 + ':' + String(mm).padStart(2,'0') + ' ' + period;
  }

  function fmt12iso(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return fmt12(
      String(d.getUTCHours()).padStart(2,'0') + ':' +
      String(d.getUTCMinutes()).padStart(2,'0')
    );
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const [y,m,d] = dateStr.split('-').map(Number);
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dt = new Date(Date.UTC(y, m-1, d));
    return days[dt.getUTCDay()] + ', ' + names[m-1] + ' ' + d;
  }

  function toMins(timeStr) {
    const [h,m] = timeStr.split(':').map(Number);
    return h*60+(m||0);
  }

  // Round duration up to nearest 15-min increment (in hours, 2-decimal)
  function roundUpTo15Min(durationMs) {
    const totalMins = durationMs / 60_000;
    const rounded   = Math.ceil(totalMins / 15) * 15;
    return Math.round((rounded / 60) * 100) / 100;
  }

  // Build full ISO datetime from date string + time string
  // endDate defaults to startDate if not provided
  function buildISO(dateStr, timeStr, endDateStr) {
    const d = endDateStr || dateStr;
    return d + 'T' + timeStr + ':00Z';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DATE STRIPS
  // ════════════════════════════════════════════════════════════════════════════

  function getDaySchedule(dow) {
    if (!hostSchedule) return null;
    return hostSchedule.find(s => s.day_of_week === dow) || null;
  }

  // Build a single date button
  function makeDateBtn(d, dateStr, onSelect) {
    const dow    = d.getUTCDay();
    const sched  = getDaySchedule(dow);
    const closed = sched && !sched.is_available;
    const DOW    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];
    const MON    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];

    // Determine availability dot
    let dotCls = 'avail';
    if (closed) dotCls = 'closed';
    // (partial detection would need pre-fetched slot data — skipped for performance)

    const btn = document.createElement('button');
    btn.className  = 'date-btn' + (closed ? ' opacity-40' : '');
    btn.disabled   = closed;
    btn.dataset.date = dateStr;
    btn.innerHTML  =
      '<div style="font-size:10px;color:#6b7280">' + DOW + '</div>' +
      '<div style="font-size:15px;font-weight:700;color:' + (closed?'#374151':'#fff') + '">' + d.getUTCDate() + '</div>' +
      '<div style="font-size:10px;color:#6b7280">' + MON + '</div>' +
      '<div class="date-dot ' + dotCls + '"></div>';

    if (!closed) btn.onclick = () => onSelect(dateStr);
    return btn;
  }

  async function buildDateStrip() {
    const strip = document.getElementById('date-strip');
    strip.innerHTML = '';
    const today = new Date();
    let firstOpenDate = null;
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      strip.appendChild(makeDateBtn(d, dateStr, selectStartDate));
      if (!firstOpenDate) {
        const dow = d.getDay();
        const sched = getDaySchedule(dow);
        if (!sched || sched.is_available) firstOpenDate = dateStr;
      }
    }
    // Pre-select the first open date visually (no spinner, no auto-popup)
    if (firstOpenDate) {
      selectedStartDate = firstOpenDate;
      selectedEndDate   = firstOpenDate;
      markDateSelected('date-strip', firstOpenDate);
      // Silently pre-fetch slots in background so first tap is instant
      fetchSlots(firstOpenDate);
    }
  }

  function buildEndDateStrip(fromDateStr) {
    const strip = document.getElementById('end-date-strip');
    strip.innerHTML = '';
    const [y,m,d] = fromDateStr.split('-').map(Number);
    const fromDate = new Date(Date.UTC(y,m-1,d));
    // Show 7 days starting from fromDateStr (same day to +6)
    for (let i = 0; i <= 6; i++) {
      const dt = new Date(fromDate);
      dt.setUTCDate(fromDate.getUTCDate() + i);
      const ds = dt.toISOString().split('T')[0];
      const btn = makeDateBtn(dt, ds, selectEndDate);
      if (i === 0) {
        // Mark same-day as "today" (the arrival date)
        btn.innerHTML += '<div style="font-size:8px;color:#6366f1;margin-top:1px">Arrive</div>';
      }
      strip.appendChild(btn);
    }
  }

  function markDateSelected(stripId, dateStr) {
    document.querySelectorAll('#' + stripId + ' .date-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.date === dateStr);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DATE SELECTION
  // ════════════════════════════════════════════════════════════════════════════

  async function selectStartDate(dateStr) {
    if (selectedStartDate === dateStr && activePickerMode === 'start') return;
    selectedStartDate = dateStr;
    selectedEndDate   = dateStr;   // default: same day
    isMultiDay        = false;
    selectedStartSlot = null;
    selectedEndSlot   = null;

    markDateSelected('date-strip', dateStr);
    resetTimeDisplays();
    resetPriceBreakdown();
    document.getElementById('end-date-row').classList.add('hidden');
    updateConfirmBtn();

    // Auto-open start picker
    await openTimePicker('start');
  }

  function selectEndDate(dateStr) {
    selectedEndDate = dateStr;
    isMultiDay      = dateStr !== selectedStartDate;
    markDateSelected('end-date-strip', dateStr);

    // Reset end slot when end date changes
    selectedEndSlot = null;
    document.getElementById('end-display').className = 'picker-value placeholder';
    document.getElementById('end-display').textContent = '— Select end time —';
    resetPriceBreakdown();
    updateConfirmBtn();

    // Immediately open end time picker
    openTimePicker('end');
  }

  function resetTimeDisplays() {
    const startDisp = document.getElementById('start-display');
    const endDisp   = document.getElementById('end-display');
    const endBtn    = document.getElementById('end-picker-btn');
    const sugRow    = document.getElementById('suggestions-row');
    const durSum    = document.getElementById('duration-summary');
    const valBan    = document.getElementById('validation-banner');
    if (startDisp) { startDisp.className = 'picker-value placeholder'; startDisp.textContent = '— Tap to choose time —'; }
    if (endDisp)   { endDisp.className   = 'picker-value placeholder'; endDisp.textContent   = '— Select start first —'; }
    if (endBtn)    endBtn.disabled = true;
    if (sugRow)    sugRow.classList.add('hidden');
    if (durSum)    durSum.classList.add('hidden');
    if (valBan)    valBan.classList.add('hidden');
    closeTimePicker();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIME PICKER
  // ════════════════════════════════════════════════════════════════════════════

  async function openTimePicker(mode) {
    activePickerMode = mode;
    const popup  = document.getElementById('time-picker-popup');
    const title  = document.getElementById('picker-title');
    const grid   = document.getElementById('time-grid');
    const loader = document.getElementById('picker-loading');

    popup.classList.remove('hidden');
    title.textContent = mode === 'start' ? 'Select Start Time' : 'Select End Time';

    // Which date to fetch slots for?
    const fetchDate = mode === 'end' ? (selectedEndDate || selectedStartDate) : selectedStartDate;

    // If already cached, skip spinner entirely for instant feel
    if (slotCache[fetchDate]) {
      grid.classList.remove('hidden');
      loader.classList.add('hidden');
      renderTimeGrid(slotCache[fetchDate], mode);
    } else {
      grid.classList.add('hidden');
      loader.classList.remove('hidden');
      const slots = await fetchSlots(fetchDate);
      loader.classList.add('hidden');
      grid.classList.remove('hidden');
      renderTimeGrid(slots, mode);
    }

    // Scroll popup into view after render (so user sees times, not the spinner)
    setTimeout(() => popup.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function toggleTimePicker(mode) {
    const popup = document.getElementById('time-picker-popup');
    if (!popup.classList.contains('hidden') && activePickerMode === mode) {
      closeTimePicker();
      return;
    }
    if (!selectedStartDate) {
      showValidation('error', 'Please select a date first.');
      return;
    }
    if (mode === 'end' && !selectedStartSlot) {
      showValidation('error', 'Please select a start time first.');
      return;
    }
    openTimePicker(mode);
  }

  function closeTimePicker() {
    const popup = document.getElementById('time-picker-popup');
    if (popup) popup.classList.add('hidden');
    activePickerMode = null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLOT FETCHING & RENDERING
  // ════════════════════════════════════════════════════════════════════════════

  async function fetchSlots(date) {
    if (!date) return [];
    if (slotCache[date]) return slotCache[date];
    try {
      const res = await fetch('/api/listings/' + LISTING_ID + '/time-slots?date=' + date);
      if (!res.ok) return [];
      const data = await res.json();
      slotCache[date] = data.slots || [];
      return slotCache[date];
    } catch { return []; }
  }

  function renderTimeGrid(slots, mode) {
    const grid = document.getElementById('time-grid');
    grid.innerHTML = '';

    // For end-picker on the same day: only show after start time
    const isEndSameDay = mode === 'end' && selectedEndDate === selectedStartDate;
    const startMins    = isEndSameDay && selectedStartSlot ? toMins(selectedStartSlot.time) : -1;

    // Build set of "in-range" minutes for highlighting
    // (only when mode=end and we're on same-day and start is selected)
    const inRangeMins = new Set();
    if (mode === 'end' && selectedStartSlot && selectedEndDate === selectedStartDate) {
      // All slots between start (exclusive) and the hover/selected end will light up
      // We highlight them dynamically on hover — static highlight uses selectedEndSlot
      if (selectedEndSlot && selectedEndDate === selectedStartDate) {
        const endMins = toMins(selectedEndSlot.time);
        for (let m = startMins + 15; m < endMins; m += 15) inRangeMins.add(m);
      }
    }

    let hasAny = false;
    slots.forEach(slot => {
      const slotMins = toMins(slot.time);

      // End-picker same-day: skip slots at or before start
      if (isEndSameDay && slotMins <= startMins) return;
      // End-picker same-day: max 24h window
      if (isEndSameDay && slotMins > startMins + 24*60) return;

      // For end-picker on a DIFFERENT day, show all available slots
      // (no filtering needed — any time on end date is valid)

      hasAny = true;
      const btn = document.createElement('button');
      let cls   = 'slot-btn ';

      if (mode === 'end' && selectedEndDate === selectedStartDate && inRangeMins.has(slotMins) && slot.status === 'available') {
        cls += 'in-range';
      } else {
        cls += slot.status;
      }

      // Mark selected
      if (mode === 'start' && selectedStartSlot?.time === slot.time) cls += ' selected';
      if (mode === 'end'   && selectedEndSlot?.time === slot.time)   cls += ' selected';

      btn.className  = cls.trim();
      btn.textContent = fmt12(slot.time);
      btn.disabled   = slot.status !== 'available';

      if (!btn.disabled) btn.onclick = () => selectTimeSlot(slot, mode);

      // Tooltips
      const tips = { booked:'Already booked', held:'Temporarily held by another user', closed:"Outside host's available hours", past:'This time has already passed' };
      if (tips[slot.status]) btn.title = tips[slot.status];

      grid.appendChild(btn);
    });

    if (!hasAny) {
      grid.innerHTML = '<p class="col-span-4 text-gray-500 text-sm text-center py-6">No available times for this ' + (mode==='end'&&isMultiDay?'date':'period') + '.</p>';
    }

    // Scroll to first available or selected slot
    const firstSel   = grid.querySelector('.slot-btn.selected');
    const firstAvail = grid.querySelector('.slot-btn:not([disabled])');
    const target = firstSel || firstAvail;
    if (target) setTimeout(() => target.scrollIntoView({ block:'nearest', behavior:'smooth' }), 50);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLOT SELECTION
  // ════════════════════════════════════════════════════════════════════════════

  function selectTimeSlot(slot, mode) {
    if (mode === 'start') {
      selectedStartSlot = slot;
      selectedEndSlot   = null;
      selectedEndDate   = selectedStartDate;  // reset end date
      isMultiDay        = false;

      document.getElementById('start-display').className = 'picker-value';
      document.getElementById('start-display').textContent = fmt12(slot.time) + ' · ' + fmtDate(selectedStartDate);

      // Enable end picker
      document.getElementById('end-picker-btn').disabled = false;
      document.getElementById('end-display').className   = 'picker-value placeholder';
      document.getElementById('end-display').textContent = '— Select end —';
      document.getElementById('end-date-row').classList.add('hidden');

      closeTimePicker();
      showSuggestions(slot);
      resetPriceBreakdown();
      updateConfirmBtn();

      // Auto-open end picker after brief delay
      setTimeout(() => openTimePicker('end'), 80);

    } else {
      // ── END slot selected ─────────────────────────────────────────────────
      selectedEndSlot = slot;

      // Check if we need to show end-date picker:
      // If selected time on same day would be <= start time, show multi-day prompt
      const endMins   = toMins(slot.time);
      const startMins = selectedStartSlot ? toMins(selectedStartSlot.time) : 0;

      if (!isMultiDay && endMins <= startMins && selectedEndDate === selectedStartDate) {
        // End time is before start — must mean they want next-day or user error
        // Show the end-date strip so they can pick a different end date
        document.getElementById('end-date-row').classList.remove('hidden');
        buildEndDateStrip(selectedStartDate);
        // Select the next day automatically
        const [y,m,d] = selectedStartDate.split('-').map(Number);
        const nextDay = new Date(Date.UTC(y,m-1,d));
        nextDay.setUTCDate(nextDay.getUTCDate()+1);
        const nextDayStr = nextDay.toISOString().split('T')[0];
        selectedEndDate = nextDayStr;
        isMultiDay = true;
        markDateSelected('end-date-strip', nextDayStr);
        // Keep the selected slot but re-render with new end date context
        document.getElementById('end-display').className   = 'picker-value';
        document.getElementById('end-display').textContent = fmt12(slot.time) + ' · ' + fmtDate(nextDayStr);
      } else {
        document.getElementById('end-display').className   = 'picker-value';
        document.getElementById('end-display').textContent = fmt12(slot.time) + ' · ' + fmtDate(selectedEndDate);
      }

      closeTimePicker();
      document.getElementById('suggestions-row').classList.add('hidden');

      // Build ISO datetimes
      const startISO = buildISO(selectedStartDate, selectedStartSlot.time);
      const endISO   = buildISO(selectedEndDate,   slot.time);
      document.getElementById('booking-arrive').value = startISO;
      document.getElementById('booking-depart').value = endISO;

      // Trigger server-side validation
      validateSlot(startISO, endISO);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // QUICK DURATION SUGGESTIONS
  // ════════════════════════════════════════════════════════════════════════════

  function showSuggestions(startSlot) {
    const row   = document.getElementById('suggestions-row');
    const chips = document.getElementById('suggestions-chips');
    chips.innerHTML = '';
    const startMins = toMins(startSlot.time);

    const DURATIONS = [
      { label: '30 min', mins: 30 },
      { label: '1 hr',   mins: 60 },
      { label: '2 hrs',  mins: 120 },
      { label: '3 hrs',  mins: 180 },
      { label: '4 hrs',  mins: 240 },
      { label: '8 hrs',  mins: 480 },
    ];

    const sameDay = slotCache[selectedStartDate] || [];

    DURATIONS.forEach(({ label, mins }) => {
      const endMins  = startMins + mins;
      const endH     = Math.floor(endMins / 60) % 24;
      const endM     = endMins % 60;
      const endTime  = String(endH).padStart(2,'0') + ':' + String(endM).padStart(2,'0');

      // Check if crosses midnight
      if (endMins >= 1440) {
        // Multi-day chip — always show (can't verify end day availability easily)
        const [y,m,d] = selectedStartDate.split('-').map(Number);
        const endDate = new Date(Date.UTC(y,m-1,d));
        endDate.setUTCMinutes(endDate.getUTCMinutes() + mins);
        const endDateStr = endDate.toISOString().split('T')[0];
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.innerHTML = '<i class="fas fa-clock"></i>' + label + ' <span class="opacity-60">(' + fmt12(endTime) + ' next day)</span>';
        chip.onclick = () => {
          selectedEndDate = endDateStr;
          isMultiDay = true;
          document.getElementById('end-date-row').classList.remove('hidden');
          buildEndDateStrip(selectedStartDate);
          markDateSelected('end-date-strip', endDateStr);
          // Fake an end slot object
          const fakeSlot = { time: endTime, iso: buildISO(endDateStr, endTime), status: 'available' };
          selectTimeSlot(fakeSlot, 'end');
        };
        chips.appendChild(chip);
        return;
      }

      // Same-day — check availability
      const endSlot = sameDay.find(s => s.time === endTime);
      if (!endSlot || endSlot.status !== 'available') return;

      const chip = document.createElement('button');
      chip.className = 'suggestion-chip';
      chip.innerHTML = '<i class="fas fa-clock"></i>' + label + ' <span class="opacity-60">(' + fmt12(endTime) + ')</span>';
      chip.onclick = () => selectTimeSlot(endSlot, 'end');
      chips.appendChild(chip);
    });

    if (chips.children.length > 0) row.classList.remove('hidden');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SERVER-SIDE SLOT VALIDATION
  // ════════════════════════════════════════════════════════════════════════════

  async function validateSlot(startISO, endISO) {
    showValidation('checking', 'Checking availability…');
    lastValidResult = null;
    updateConfirmBtn();
    clearTimeout(validationTimer);

    validationTimer = setTimeout(async () => {
      try {
        const res  = await fetch('/api/listings/' + LISTING_ID + '/validate-slot', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ start_datetime: startISO, end_datetime: endISO }),
        });
        const data = await res.json();
        if (data.valid) {
          lastValidResult = data.pricing;
          showValidation('valid', 'This time slot is available!');
          updatePriceFromPricing(data.pricing);
          updateDurationSummary(data.pricing, startISO, endISO);
          updateConfirmBtn();
        } else {
          lastValidResult = null;
          showValidation('error', data.error || 'This time slot is unavailable.');
          resetPriceBreakdown();
          // Bust cache if the slot was grabbed by someone else
          if (['SLOT_BOOKED','SLOT_HELD'].includes(data.code || '')) {
            delete slotCache[selectedStartDate];
            if (selectedEndDate && selectedEndDate !== selectedStartDate) delete slotCache[selectedEndDate];
          }
          updateConfirmBtn();
        }
      } catch {
        showValidation('error', 'Could not check availability. Please try again.');
        lastValidResult = null;
        updateConfirmBtn();
      }
    }, 350);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  function showValidation(type, msg) {
    const banner = document.getElementById('validation-banner');
    const icon   = document.getElementById('validation-icon');
    banner.classList.remove('hidden','checking','valid','error');
    banner.classList.add(type);
    document.getElementById('validation-msg').textContent = msg;
    icon.className = type === 'checking'
      ? 'fas fa-spinner fa-spin mt-0.5 flex-shrink-0'
      : type === 'valid'
        ? 'fas fa-check-circle mt-0.5 flex-shrink-0'
        : 'fas fa-exclamation-circle mt-0.5 flex-shrink-0';
  }

  function updatePriceFromPricing(pricing) {
    if (!pricing) return;
    const hrs    = pricing.hours;
    const rateEl  = document.getElementById('rate-label');
    const baseEl  = document.getElementById('base-amount');
    const feeEl   = document.getElementById('fee-amount');
    const totalEl = document.getElementById('total-amount');
    if (rateEl)  rateEl.textContent  = '$' + pricing.rate_per_hour + '/hr × ' + hrs + ' hr' + (hrs !== 1 ? 's' : '');
    if (baseEl)  baseEl.textContent  = '$' + Number(pricing.subtotal).toFixed(2);
    if (feeEl)   feeEl.textContent   = '$' + Number(pricing.platform_fee).toFixed(2);
    if (totalEl) totalEl.textContent = '$' + Number(pricing.total).toFixed(2);
    // confirm-label updated by updateConfirmBtn() to avoid overwrite race conditions
    updateConfirmBtn();
  }

  function updateDurationSummary(pricing, startISO, endISO) {
    const el = document.getElementById('duration-summary');
    el.classList.remove('hidden');
    const startFmt = fmt12iso(startISO);
    const endFmt   = fmt12iso(endISO);
    const dateRange = isMultiDay
      ? fmtDate(selectedStartDate) + ' → ' + fmtDate(selectedEndDate)
      : fmtDate(selectedStartDate);
    document.getElementById('dur-label').textContent    = startFmt + ' → ' + endFmt;
    document.getElementById('dur-sublabel').textContent = pricing.hours + ' hour' + (pricing.hours !== 1 ? 's' : '') + ' · ' + dateRange;
    document.getElementById('dur-total').textContent    = '$' + pricing.total.toFixed(2);
  }

  function resetPriceBreakdown() {
    const rateEl  = document.getElementById('rate-label');
    const baseEl  = document.getElementById('base-amount');
    const feeEl   = document.getElementById('fee-amount');
    const totalEl = document.getElementById('total-amount');
    const durEl   = document.getElementById('duration-summary');
    if (rateEl)  rateEl.textContent  = 'Rate × hours';
    if (baseEl)  baseEl.textContent  = '—';
    if (feeEl)   feeEl.textContent   = '—';
    if (totalEl) totalEl.textContent = '—';
    if (durEl)   durEl.classList.add('hidden');
    lastValidResult = null;
    updateConfirmBtn();
  }

  function updateConfirmBtn() {
    const btn   = document.getElementById('confirm-btn');
    const label = document.getElementById('confirm-label');
    const icon  = document.getElementById('confirm-icon');
    if (!btn || !label) return;  // null guard

    const termsAck  = !!(document.getElementById('terms-check')?.checked);
    const cancelAck = !!(document.getElementById('cancel-ack-checkbox')?.checked);
    const bothAcks  = termsAck && cancelAck;

    // Determine readiness — ordered by booking flow steps
    const ready = !!(selectedStartSlot && selectedEndSlot && lastValidResult && bothAcks);
    btn.disabled = !ready;

    if (ready) {
      // Show price in button label
      const total = lastValidResult?.total;
      label.textContent = total ? 'Confirm & Pay  $' + Number(total).toFixed(2) : 'Confirm & Pay';
      if (icon) icon.className = 'fas fa-check-circle';
      btn.classList.remove('opacity-60');
    } else {
      // Guide user through flow steps in order
      if (!selectedStartSlot)    label.textContent = 'Select a start time';
      else if (!selectedEndSlot) label.textContent = 'Select an end time';
      else if (!lastValidResult) label.textContent = 'Checking availability…';
      else if (!termsAck)        label.textContent = 'Accept Terms of Service';
      else if (!cancelAck)       label.textContent = 'Acknowledge cancellation policy';
      if (icon) icon.className = 'fas fa-lock';
      btn.classList.add('opacity-60');
    }
  }
  function updateConfirmButton() { updateConfirmBtn(); }

  // ════════════════════════════════════════════════════════════════════════════
  // HOST SCHEDULE SIDEBAR
  // ════════════════════════════════════════════════════════════════════════════

  function renderHostSchedule() {
    if (!hostSchedule || !hostSchedule.length) return;
    const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const container = document.getElementById('schedule-rows');
    container.innerHTML = '';
    hostSchedule.forEach(s => {
      const row = document.createElement('div');
      row.className = 'flex justify-between text-xs py-0.5';
      const avail = s.is_available;
      row.innerHTML =
        '<span class="text-gray-400">' + DAY[s.day_of_week] + '</span>' +
        '<span class="' + (avail ? 'text-green-400' : 'text-gray-500 line-through') + '">' +
          (avail ? fmt12(s.open_time) + ' – ' + fmt12(s.close_time) : 'Closed') +
        '</span>';
      container.appendChild(row);
    });
    document.getElementById('host-schedule-preview').classList.remove('hidden');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LISTING LOADER
  // ════════════════════════════════════════════════════════════════════════════

  async function loadListing() {
    try {
      const [listRes, schedRes] = await Promise.all([
        fetch('/api/listings/' + LISTING_ID),
        fetch('/api/listings/' + LISTING_ID + '/availability-schedule'),
      ]);

      if (listRes.ok) {
        listingData = await listRes.json();
        document.getElementById('listing-title').textContent   = listingData.title || 'Parking Space';
        document.getElementById('listing-address').textContent =
          [listingData.address, listingData.city].filter(Boolean).join(', ') || '—';
        const rating  = listingData.rating;
        const reviews = listingData.review_count || 0;
        if (rating) {
          document.getElementById('listing-rating').textContent  = Number(rating).toFixed(1);
          document.getElementById('listing-reviews').textContent = '(' + reviews + ' reviews)';
        }
        const icons = {driveway:'fa-house',garage:'fa-warehouse',lot:'fa-square-parking',street:'fa-road',covered:'fa-building'};
        document.getElementById('listing-icon').className = 'fas ' + (icons[listingData.type] || 'fa-square-parking') + ' text-white/20 text-2xl';
        document.getElementById('success-address').textContent =
          [listingData.address, listingData.city].filter(Boolean).join(', ') || '';
      }

      if (schedRes.ok) {
        const schedData = await schedRes.json();
        hostSchedule = schedData.schedule || [];
        renderHostSchedule();
      }

    } catch(e) {
      console.warn('[loadListing]', e.message);
    } finally {
      await buildDateStrip();
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HOLD COUNTDOWN
  // ════════════════════════════════════════════════════════════════════════════

  function startHoldCountdown(expiresAt) {
    const el   = document.getElementById('hold-countdown');
    const text = document.getElementById('hold-countdown-text');
    if (!el || !expiresAt) return;
    el.classList.remove('hidden');
    if (holdCountdownTimer) clearInterval(holdCountdownTimer);

    holdCountdownTimer = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
      const m = Math.floor(s / 60);
      if (s > 0) {
        text.textContent = 'Slot reserved — ' + m + ':' + String(s%60).padStart(2,'0') + ' remaining';
        el.className = el.className.replace('text-red-400','') + ' text-indigo-300';
      } else {
        clearInterval(holdCountdownTimer);
        text.textContent = 'Slot hold expired — please re-add your card to re-lock it.';
        el.classList.add('text-red-400');
        stripeReady = false;
        // Release the associated lock before nulling the token
        releaseHoldSilently();
        holdId = null; holdSessionToken = null;
      }
    }, 1000);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STRIPE HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  function showStripeError(msg) {
    const el = document.getElementById('stripe-card-errors');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function clearStripeError() {
    const el = document.getElementById('stripe-card-errors');
    el.textContent = '';
    el.classList.add('hidden');
  }

  function toggleNewCard() {
    const form = document.getElementById('new-card-form');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden') && !stripeReady) {
      initStripe();
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STRIPE INITIALISATION (holds-first flow)
  // ════════════════════════════════════════════════════════════════════════════

  async function initStripe() {
    if (stripeReady) return;
    clearStripeError();
    try {
      const arrive = document.getElementById('booking-arrive').value;
      const depart = document.getElementById('booking-depart').value;
      const email  = document.getElementById('contact-email')?.value?.trim() || '';

      if (!arrive || !depart) {
        showStripeError('Please select arrival and departure times first.');
        return;
      }
      if (!lastValidResult) {
        showStripeError('Please wait for availability check to complete.');
        return;
      }

      // ── STEP 1: Acquire / verify hold ─────────────────────────────────────
      if (holdId && holdSessionToken) {
        // Check existing hold is still valid
        const chk = await fetch('/api/holds/' + holdSessionToken).catch(() => null);
        if (chk?.ok) {
          const chkData = await chk.json();
          if (chkData.valid && chkData.status === 'active') {
            // Hold still good — skip re-acquiring
            goto_stripe: {
              return await mountStripe(arrive, depart, email, holdId, holdSessionToken, holdExpiresAt);
            }
          }
        }
        // Hold expired — clear and re-acquire below
        holdId = null; holdSessionToken = null; holdExpiresAt = null;
      }

      const holdRes = await fetch('/api/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id:     LISTING_ID,
          start_datetime: arrive,
          end_datetime:   depart,
          checkout_token: checkoutToken,
          ...(holdSessionToken ? { session_token: holdSessionToken } : {}),
        }),
      });
      const holdData = await holdRes.json();
      if (!holdRes.ok) {
        const code = holdData.code || '';
        if (code === 'SLOT_BOOKED') {
          delete slotCache[selectedStartDate];
          if (selectedEndDate !== selectedStartDate) delete slotCache[selectedEndDate];
          showStripeError('This parking spot was just booked by someone else. Please choose a different time.');
        } else if (code === 'SLOT_HELD') {
          showStripeError('Another user is checking out this slot right now. Please wait 1–2 minutes and try again.');
        } else if (code === 'HOST_CLOSED_DAY') {
          showStripeError(holdData.error || 'The host is not available on the selected day.');
        } else if (code === 'OUTSIDE_HOST_HOURS') {
          showStripeError(holdData.error || "Your selected time is outside the host's available hours.");
        } else if (code === 'LISTING_UNAVAILABLE') {
          showStripeError('This listing is no longer available. Please search for another spot.');
        } else {
          showStripeError(holdData.error || 'Could not reserve this slot. Please try again.');
        }
        return;
      }

      holdId           = holdData.hold_id;
      holdSessionToken = holdData.session_token;
      holdExpiresAt    = holdData.expires_at;

      await mountStripe(arrive, depart, email, holdId, holdSessionToken, holdExpiresAt);

    } catch(e) {
      showStripeError('Initialisation error: ' + (e.message || 'Please try again.'));
    }
  }

  async function mountStripe(arrive, depart, email, hId, hToken, hExpires) {
    startHoldCountdown(hExpires);

    // ── STEP 2: Get Stripe publishable key ────────────────────────────────
    const cfgRes = await fetch('/api/stripe/config');
    const cfg    = await cfgRes.json();
    if (!cfg.publishableKey) throw new Error('Stripe is not configured on this account.');
    stripe = Stripe(cfg.publishableKey);

    // ── STEP 3: Create Payment Intent tied to hold ─────────────────────────
    const piRes = await fetch('/api/payments/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        listing_id:     LISTING_ID,
        hold_id:        hId,
        session_token:  hToken,
        checkout_token: checkoutToken,
        start_datetime: arrive,
        end_datetime:   depart,
        driver_email:   email || 'guest@parkpeer.app',
      }),
    });
    const piData = await piRes.json();
    if (!piRes.ok || !piData.clientSecret) {
      const code = piData.code || '';
      if (code === 'HOLD_EXPIRED') {
        holdId = null; holdSessionToken = null;
        showStripeError('Your slot reservation expired. Please click "Add Card" again to re-lock it.');
      } else if (code === 'HOLD_CONVERTED') {
        showStripeError('This booking was already completed. Check your email for confirmation.');
      } else {
        showStripeError(piData.error || 'Payment setup failed. Please try again.');
      }
      return;
    }

    // Update pricing from PI response
    if (piData.pricing) {
      lastValidResult = piData.pricing;
      updatePriceFromPricing(piData.pricing);
    }

    // ── STEP 4: Mount Stripe Payment Element ──────────────────────────────
    stripeElements = stripe.elements({
      clientSecret: piData.clientSecret,
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary:     '#6366f1',
          colorBackground:  '#1e1e2e',
          colorText:        '#ffffff',
          fontFamily:       'system-ui, sans-serif',
          borderRadius:     '10px',
        },
      },
    });
    paymentElement = stripeElements.create('payment');
    paymentElement.mount('#stripe-payment-element');
    paymentElement.on('ready', () => {
      stripeReady = true;
      clearStripeError();
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONFIRM BOOKING
  // ════════════════════════════════════════════════════════════════════════════

  async function confirmBooking() {
    clearStripeError();

    // ── Guard: terms ──────────────────────────────────────────────────────────
    const terms = document.getElementById('terms-check');
    if (!terms || !terms.checked) {
      const termsLabel = document.getElementById('terms-check-label');
      if (termsLabel) termsLabel.classList.add('ring','ring-red-500/40','rounded-xl','p-2');
      showValidation('error', 'Please accept the Terms of Service to continue.');
      return;
    }
    const ack = document.getElementById('cancel-ack-checkbox');
    if (!ack?.checked) {
      document.getElementById('cancel-ack-label')?.classList.add('ring','ring-red-500/40','rounded-xl','p-2');
      showValidation('error', 'Please acknowledge the Cancellation Policy to continue.');
      return;
    }

    // ── Guard: slot selection ─────────────────────────────────────────────────
    if (!selectedStartSlot) {
      showValidation('error', 'Please select a start time.');
      return;
    }
    if (!selectedEndSlot) {
      showValidation('error', 'Please select an end time.');
      return;
    }

    const arrive = document.getElementById('booking-arrive')?.value;
    const depart = document.getElementById('booking-depart')?.value;
    if (!arrive || !depart) { showValidation('error', 'Please select arrival and departure times.'); return; }
    if (!lastValidResult)   { showValidation('error', 'Please wait for availability to be confirmed.'); return; }

    const btn = document.getElementById('confirm-btn');
    const lbl = document.getElementById('confirm-label');
    const ico = document.getElementById('confirm-icon');
    if (btn) {
      btn.disabled = true;
      if (ico) ico.className = 'fas fa-spinner fa-spin';
      if (lbl) lbl.textContent = 'Processing…';
    }

    try {
      const firstName  = (document.getElementById('contact-first')?.value || '').trim();
      const lastName   = (document.getElementById('contact-last')?.value  || '').trim();
      const phone      = (document.getElementById('contact-phone')?.value || '').trim();
      const email      = (document.getElementById('contact-email')?.value || '').trim();
      const driverName = [firstName, lastName].filter(Boolean).join(' ') || 'Guest';
      const plate      = (document.getElementById('vehicle-plate')?.value || '').trim() || null;

      // ── Case A: Stripe card form is mounted and ready ─────────────────────
      if (stripe && stripeReady && !document.getElementById('new-card-form').classList.contains('hidden')) {

        const { error, paymentIntent } = await stripe.confirmPayment({
          elements: stripeElements,
          redirect: 'if_required',
          confirmParams: {
            // return_url is required for 3DS/redirect-based payment methods.
            // After 3DS the browser returns here carrying the payment_intent query param;
            // the server confirms the booking and sets the session cookie before the redirect.
            return_url: window.location.origin + '/booking/confirmation/pending?hold=' + encodeURIComponent(holdId || '') + '&token=' + encodeURIComponent(holdSessionToken || ''),
            payment_method_data: {
              billing_details: { name: driverName, email: email || undefined, phone: phone || undefined },
            },
          },
        });

        if (error) {
          showStripeError(error.message || 'Payment declined. Please try a different card.');
          if (ico) ico.className = 'fas fa-redo';
          if (lbl) lbl.textContent = 'Retry Payment';
          if (btn) btn.disabled = false;
          return;
        }
        if (paymentIntent?.status !== 'succeeded') {
          showStripeError('Payment was not completed (status: ' + (paymentIntent?.status || 'unknown') + '). Please try again.');
          if (ico) ico.className = 'fas fa-redo';
          if (lbl) lbl.textContent = 'Retry Payment';
          if (btn) btn.disabled = false;
          return;
        }

        // ── POST /api/payments/confirm ─────────────────────────────────────
        const cfRes = await fetch('/api/payments/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            payment_intent_id:           paymentIntent.id,
            hold_id:                     holdId,
            session_token:               holdSessionToken,
            checkout_token:              checkoutToken,
            listing_id:                  LISTING_ID,
            driver_name:                 driverName,
            driver_email:                email || null,
            driver_phone:                phone || null,
            start_datetime:              arrive,
            end_datetime:                depart,
            vehicle_plate:               plate,
            cancellation_acknowledged:   true,
            cancellation_policy_version: '1.0',
          }),
        });
        const cfData = await cfRes.json();

        if (!cfRes.ok) {
          showStripeError(cfData.error || 'Booking confirmation failed. Your payment was captured — our team will contact you.');
          if (ico) ico.className = 'fas fa-headset';
          if (lbl) lbl.textContent = 'Contact Support';
          if (btn) btn.disabled = false;
          return;
        }

        if (holdCountdownTimer) clearInterval(holdCountdownTimer);
        dbBookingId = cfData.db_booking_id || cfData.booking_id;  // mark as confirmed
        showSuccessModal(cfData.booking_reference || cfData.booking_id, arrive, depart);
        return;
      }

      // ── Case B: Card form not open yet — open it ──────────────────────────
      const cardForm   = document.getElementById('new-card-form');
      const addCardBtn = document.getElementById('add-card-btn');
      if (cardForm)   cardForm.classList.remove('hidden');
      if (addCardBtn) addCardBtn.classList.add('hidden');
      await initStripe();
      if (ico) ico.className = 'fas fa-credit-card';
      if (lbl) lbl.textContent = 'Complete Payment';
      if (btn) btn.disabled = false;
      if (cardForm) cardForm.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } catch(e) {
      showStripeError('Network error: ' + (e.message || 'Please check your connection and try again.'));
      if (ico) ico.className = 'fas fa-lock';
      if (lbl) lbl.textContent = 'Confirm & Pay';
      if (btn) btn.disabled = false;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUCCESS MODAL
  // ════════════════════════════════════════════════════════════════════════════

  function showSuccessModal(bookingRef, arrive, depart) {
    // bookingRef might be "PP-2024-0001" or a numeric id
    const refDisplay = typeof bookingRef === 'string' && bookingRef.startsWith('PP-')
      ? bookingRef
      : 'PP-' + new Date().getFullYear() + '-' + String(bookingRef || '?').padStart(4,'0');

    document.getElementById('success-booking-ref').textContent = refDisplay;
    const startFmt = arrive ? fmt12iso(arrive) : '';
    const endFmt   = depart ? fmt12iso(depart) : '';
    const dateRange = isMultiDay
      ? fmtDate(selectedStartDate) + ' → ' + fmtDate(selectedEndDate)
      : fmtDate(selectedStartDate);
    document.getElementById('success-time').textContent = dateRange + '  ·  ' + startFmt + ' – ' + endFmt;
    document.getElementById('success-modal').classList.remove('hidden');

    // Auto-redirect to the premium confirmation page after 2.5 seconds
    if (dbBookingId) {
      setTimeout(() => {
        window.location.href = '/booking/confirmation/' + dbBookingId;
      }, 2500);
    }
  }

  // Navigate to the premium confirmation page after booking is confirmed.
  // • If user has a real dbBookingId → go to /booking/confirmation/:id (premium UX)
  // • If guest checkout (no session) → go to dashboard, which will redirect to login first.
  function viewBookingAfterConfirm() {
    if (dbBookingId) {
      // Premium confirmation page with countdown, directions, confetti
      window.location.href = '/booking/confirmation/' + dbBookingId;
    } else {
      window.location.href = '/dashboard?tab=upcoming';
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MISC UI
  // ════════════════════════════════════════════════════════════════════════════

  function selectVehicle(btn) {
    document.querySelectorAll('.vehicle-btn').forEach(b => {
      b.className = 'vehicle-btn p-3 rounded-xl border text-center transition-all border-white/5 bg-charcoal-200 hover:border-indigo-500/50';
    });
    btn.className = 'vehicle-btn p-3 rounded-xl border text-center transition-all border-indigo-500 bg-indigo-500/10';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HOLD RELEASE — free the slot if user leaves without paying
  // ════════════════════════════════════════════════════════════════════════════

  function releaseHoldSilently() {
    // Only release if we have an active hold that hasn't been converted to a booking
    if (!holdSessionToken || dbBookingId) return;
    try {
      const url = '/api/holds/' + holdSessionToken + '/release';
      // sendBeacon is the most reliable way to fire a request during page unload.
      // Pass a Blob so the browser sets Content-Type: application/json correctly.
      if (navigator.sendBeacon) {
        const payload = new Blob([JSON.stringify({ released_by: 'page_unload' })], { type: 'application/json' });
        navigator.sendBeacon(url, payload);
      } else {
        // keepalive ensures the fetch survives page navigation
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ released_by: 'page_unload' }),
          keepalive: true,
        }).catch(() => {});
      }
    } catch(e) {}
  }

  // ── beforeunload: fires when closing tab or navigating away ──────────────
  window.addEventListener('beforeunload', function() {
    releaseHoldSilently();
  });

  // ── pagehide: fires on mobile Safari / bfcache navigation (more reliable
  //    than beforeunload on iOS) ────────────────────────────────────────────
  window.addEventListener('pagehide', function(e) {
    // e.persisted = true means page is going into bfcache (back/forward nav);
    // still release the hold — user navigated away from the booking flow.
    releaseHoldSilently();
  });

  // ── visibilitychange: tab switch / app backgrounded on mobile ────────────
  // Only release when the document is being *discarded* (freeze → not visible),
  // NOT on a simple tab switch (user might come back).
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      // Use a short grace period: if the user comes back within 30 s we do
      // NOT want to have released the hold.  The 10-min server TTL handles
      // the case where they genuinely abandon; here we only trigger on
      // pagehide/beforeunload for an immediate release.
      // Nothing to do on visibilitychange — server TTL is the safety net.
    }
  });

  // ── Explicit back-link clicks inside the page ─────────────────────────────
  document.querySelectorAll('a[href*="/listing/"]').forEach(function(link) {
    link.addEventListener('click', function() {
      releaseHoldSilently();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // CONTACT VERIFICATION — Email & Phone OTP
  // ════════════════════════════════════════════════════════════════════════════

  // ── Verification state ────────────────────────────────────────────────────
  let emailVerified    = false;   // true once OTP confirmed
  let phoneVerified    = false;
  let otpMode          = null;    // 'email' | 'phone'
  let otpResendTimer   = null;    // setInterval handle
  let otpResendSeconds = 0;

  // ── Email input — real-time validation + domain autocomplete ────────────
  const COMMON_DOMAINS = [
    'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com',
    'me.com','mac.com','aol.com','live.com','msn.com','protonmail.com',
    'proton.me','googlemail.com','ymail.com'
  ];
  // Common typos map → corrected domain
  const DOMAIN_TYPOS = {
    'gmial.com':'gmail.com','gmaill.com':'gmail.com','gmai.com':'gmail.com',
    'gmail.co':'gmail.com','gmail.con':'gmail.com','gmail.cpm':'gmail.com',
    'yahooo.com':'yahoo.com','yahoo.co':'yahoo.com','yahoo.con':'yahoo.com',
    'outlok.com':'outlook.com','outloook.com':'outlook.com','outlookk.com':'outlook.com',
    'hotmial.com':'hotmail.com','hotmall.com':'hotmail.com','hotmaill.com':'hotmail.com',
    'iclould.com':'icloud.com','icolud.com':'icloud.com',
  };

  function updateEmailSuggestions(localPart) {
    const dl = document.getElementById('email-suggestions');
    if (!dl) return;
    dl.innerHTML = '';
    COMMON_DOMAINS.forEach(d => {
      const opt = document.createElement('option');
      opt.value = localPart + '@' + d;
      dl.appendChild(opt);
    });
  }

  function onEmailInput() {
    const inp  = document.getElementById('contact-email');
    const hint = document.getElementById('email-hint');
    const btn  = document.getElementById('email-verify-btn');
    const badge= document.getElementById('email-verify-badge');
    const val  = inp.value.trim();
    const re   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    // Reset hint + border each time to avoid sticky errors
    hint.textContent = '';
    hint.classList.add('hidden');
    inp.style.borderColor = '';
    btn.classList.add('hidden');

    // If user edits after verification, reset
    if (emailVerified) {
      emailVerified = false;
      badge.classList.add('hidden');
    }

    if (val.length === 0) return;

    // Update domain autocomplete suggestions when user types @
    const atIdx = val.indexOf('@');
    if (atIdx > 0) {
      const localPart = val.slice(0, atIdx);
      const typed = val.slice(atIdx + 1).toLowerCase();
      // Populate datalist with matching domains
      const dl = document.getElementById('email-suggestions');
      if (dl) {
        dl.innerHTML = '';
        COMMON_DOMAINS
          .filter(d => d.startsWith(typed))
          .forEach(d => {
            const opt = document.createElement('option');
            opt.value = localPart + '@' + d;
            dl.appendChild(opt);
          });
      }
      // Typo detection
      if (DOMAIN_TYPOS[typed]) {
        const fix = DOMAIN_TYPOS[typed];
        const corrected = localPart + '@' + fix;
        hint.textContent = '';
        hint.className = 'text-xs mt-1 text-amber-400';
        hint.classList.remove('hidden');
        // Build hint with a safe DOM button (no inline onclick)
        const span = document.createElement('span');
        span.textContent = 'Did you mean ';
        const strong = document.createElement('strong');
        strong.textContent = corrected;
        const space = document.createTextNode('? ');
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'underline ml-1';
        link.textContent = 'Use this';
        link.addEventListener('click', function(e) {
          e.preventDefault();
          document.getElementById('contact-email').value = corrected;
          onEmailInput();
        });
        hint.appendChild(span);
        hint.appendChild(strong);
        hint.appendChild(space);
        hint.appendChild(link);
        inp.style.borderColor = 'rgba(251,191,36,.4)';
        return;
      }
    } else {
      // No @ yet — populate all common domain suggestions
      updateEmailSuggestions(val);
    }

    if (re.test(val) && val.length <= 254) {
      hint.classList.add('hidden');
      btn.classList.remove('hidden');
      inp.style.borderColor = 'rgba(99,102,241,.6)';
    } else {
      // Progressive hint
      if (!val.includes('@')) {
        hint.textContent = 'Continue typing your email address (e.g. name@gmail.com)';
        hint.className = 'text-xs mt-1 text-gray-500';
      } else if (val.split('@').length > 2) {
        hint.textContent = 'Email address can only have one @';
        hint.className = 'text-xs mt-1 text-red-400';
        inp.style.borderColor = 'rgba(239,68,68,.4)';
      } else {
        const domain = val.split('@')[1] || '';
        if (!domain.includes('.')) {
          hint.textContent = 'Add the domain extension, e.g. @gmail.com';
          hint.className = 'text-xs mt-1 text-amber-400';
          inp.style.borderColor = 'rgba(251,191,36,.4)';
        } else {
          hint.textContent = 'Check your email address format';
          hint.className = 'text-xs mt-1 text-amber-400';
          inp.style.borderColor = 'rgba(251,191,36,.4)';
        }
      }
      hint.classList.remove('hidden');
    }
  }

  // ── Phone input — validation only, no auto-formatting ───────────────────
  function onPhoneInput() {
    const inp   = document.getElementById('contact-phone');
    const hint  = document.getElementById('phone-hint');
    const btn   = document.getElementById('phone-verify-btn');
    const badge = document.getElementById('phone-verify-badge');
    const raw   = inp.value;

    // If user edits after verification, reset verified state
    if (phoneVerified) {
      phoneVerified = false;
      badge.classList.add('hidden');
      inp.style.borderColor = '';
    }

    // Always reset hint first to avoid sticky messages
    hint.textContent = '';
    hint.classList.add('hidden');
    btn.classList.add('hidden');
    inp.style.borderColor = '';

    if (raw.length === 0) return;

    // Count digits only for validation
    const digits = raw.replace(/\D/g, '');
    const len    = digits.length;

    // Valid formats:
    //   • 10 US digits (e.g. 5551234567)
    //   • 11 digits starting with 1 (e.g. 15551234567)
    //   • International with + prefix (7–15 digits total, e.g. +442071234567)
    const isUS10  = len === 10 && !raw.trim().startsWith('+');
    const isUS11  = len === 11 && digits[0] === '1';
    const isIntl  = raw.trim().startsWith('+') && len >= 7 && len <= 15;
    const isValid = isUS10 || isUS11 || isIntl;

    if (isValid) {
      btn.classList.remove('hidden');
      inp.style.borderColor = 'rgba(99,102,241,.6)';
    } else if (len > 15 || (raw.trim().startsWith('+') && len > 15)) {
      hint.textContent = 'Number too long — max 15 digits';
      hint.className = 'text-xs mt-1 text-red-400';
      hint.classList.remove('hidden');
      inp.style.borderColor = 'rgba(239,68,68,.5)';
    } else if (len > 0 && len < 10) {
      const need = 10 - len;
      hint.textContent = need + ' more digit' + (need === 1 ? '' : 's') + ' needed';
      hint.className = 'text-xs mt-1 text-gray-500';
      hint.classList.remove('hidden');
      inp.style.borderColor = 'rgba(255,255,255,.1)';
    } else if (len > 10 && !isUS11) {
      hint.textContent = 'Use +1XXXXXXXXXX for US or +country-code for international';
      hint.className = 'text-xs mt-1 text-amber-400';
      hint.classList.remove('hidden');
      inp.style.borderColor = 'rgba(251,191,36,.4)';
    }
  }

  // ── OTP digit input builder ───────────────────────────────────────────────
  function buildOtpDigits() {
    const row = document.getElementById('otp-digit-row');
    row.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.maxLength = 1;
      inp.dataset.idx = String(i);
      inp.id = 'otp-d' + i;
      inp.className = 'w-11 h-12 text-center text-xl font-bold text-white bg-white/5 border border-white/20 rounded-xl focus:outline-none focus:border-indigo-400 transition-colors';
      inp.addEventListener('input', onOtpDigit);
      inp.addEventListener('keydown', onOtpKey);
      inp.addEventListener('paste', onOtpPaste);
      row.appendChild(inp);
    }
  }

  function onOtpDigit(e) {
    const inp = e.target;
    const idx = parseInt(inp.dataset.idx);
    // Accept only digits
    inp.value = inp.value.replace(/\D/g,'').slice(-1);
    if (inp.value && idx < 5) {
      document.getElementById('otp-d' + (idx+1))?.focus();
    }
    updateOtpVerifyBtn();
  }

  function onOtpKey(e) {
    const inp = e.target;
    const idx = parseInt(inp.dataset.idx);
    if (e.key === 'Backspace' && !inp.value && idx > 0) {
      const prev = document.getElementById('otp-d' + (idx-1));
      if (prev) { prev.value = ''; prev.focus(); }
    }
    if (e.key === 'ArrowLeft' && idx > 0) document.getElementById('otp-d' + (idx-1))?.focus();
    if (e.key === 'ArrowRight' && idx < 5) document.getElementById('otp-d' + (idx+1))?.focus();
    if (e.key === 'Enter') submitOtpCode();
  }

  function onOtpPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
    text.split('').forEach((ch, i) => {
      const d = document.getElementById('otp-d' + i);
      if (d) d.value = ch;
    });
    document.getElementById('otp-d' + Math.min(text.length, 5))?.focus();
    updateOtpVerifyBtn();
  }

  function getOtpCode() {
    return Array.from({length:6}, (_,i) => document.getElementById('otp-d'+i)?.value || '').join('');
  }

  function updateOtpVerifyBtn() {
    const btn = document.getElementById('otp-verify-btn');
    if (btn) btn.disabled = getOtpCode().length < 6;
  }

  // ── Open / close modal ────────────────────────────────────────────────────
  function openOtpModal(mode, destination) {
    otpMode = mode;
    const modal    = document.getElementById('otp-modal');
    const title    = document.getElementById('otp-modal-title');
    const subtitle = document.getElementById('otp-modal-subtitle');
    const icon     = document.getElementById('otp-modal-icon');
    const dest     = document.getElementById('otp-modal-dest');
    const errMsg   = document.getElementById('otp-error-msg');
    const sucMsg   = document.getElementById('otp-success-msg');

    title.textContent    = mode === 'phone' ? 'Verify your phone' : 'Verify your email';
    subtitle.textContent = mode === 'phone'
      ? 'We sent a 6-digit code via SMS'
      : 'We sent a 6-digit code to your email';
    icon.className = mode === 'phone'
      ? 'fas fa-mobile-screen text-indigo-400 text-sm'
      : 'fas fa-envelope text-indigo-400 text-sm';
    dest.textContent = destination;
    errMsg.classList.add('hidden');
    sucMsg.classList.add('hidden');

    buildOtpDigits();
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('otp-d0')?.focus(), 100);
    startResendTimer(60);
  }

  function closeOtpModal() {
    document.getElementById('otp-modal').classList.add('hidden');
    if (otpResendTimer) { clearInterval(otpResendTimer); otpResendTimer = null; }
    otpMode = null;
  }

  // ── Resend timer ─────────────────────────────────────────────────────────
  function startResendTimer(seconds) {
    const timerEl  = document.getElementById('otp-resend-timer');
    const resendBtn= document.getElementById('otp-resend-btn');
    if (otpResendTimer) clearInterval(otpResendTimer);
    otpResendSeconds = seconds;
    resendBtn.disabled = true;
    resendBtn.style.opacity = '0.4';
    timerEl.classList.remove('hidden');
    timerEl.textContent = 'Resend in ' + seconds + 's';
    otpResendTimer = setInterval(() => {
      otpResendSeconds--;
      if (otpResendSeconds <= 0) {
        clearInterval(otpResendTimer);
        otpResendTimer = null;
        timerEl.classList.add('hidden');
        resendBtn.disabled = false;
        resendBtn.style.opacity = '1';
      } else {
        timerEl.textContent = 'Resend in ' + otpResendSeconds + 's';
      }
    }, 1000);
  }

  // ── Start email verify ────────────────────────────────────────────────────
  async function startEmailVerify() {
    const email = document.getElementById('contact-email').value.trim();
    const btn   = document.getElementById('email-verify-btn');
    const hint  = document.getElementById('email-hint');

    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/verify/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, session_token: checkoutToken })
      });
      const data = await res.json();
      if (!res.ok) {
        hint.textContent = data.error || 'Could not send verification email. Try again.';
        hint.className = 'text-xs mt-1 text-red-400';
        hint.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Verify →';
        return;
      }
      hint.textContent = '✓ Check your inbox (also spam folder)';
      hint.className = 'text-xs mt-1 text-green-400';
      hint.classList.remove('hidden');
      openOtpModal('email', data.masked_email || email);
    } catch(e) {
      hint.textContent = 'Network error. Please try again.';
      hint.className = 'text-xs mt-1 text-red-400';
      hint.classList.remove('hidden');
    }
    btn.disabled = false;
    btn.textContent = 'Verify →';
  }

  // ── Start phone verify ────────────────────────────────────────────────────
  async function startPhoneVerify() {
    const phone = document.getElementById('contact-phone').value.trim();
    const btn   = document.getElementById('phone-verify-btn');
    const hint  = document.getElementById('phone-hint');

    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/verify/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, session_token: checkoutToken })
      });
      const data = await res.json();
      if (!res.ok) {
        hint.textContent = data.error || 'Could not send SMS. Check the number and try again.';
        hint.className = 'text-xs mt-1 text-red-400';
        hint.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Verify →';
        return;
      }
      hint.textContent = '✓ SMS sent — check your messages';
      hint.className = 'text-xs mt-1 text-green-400';
      hint.classList.remove('hidden');
      openOtpModal('phone', data.masked_phone || phone);
    } catch(e) {
      hint.textContent = 'Network error. Please try again.';
      hint.className = 'text-xs mt-1 text-red-400';
      hint.classList.remove('hidden');
    }
    btn.disabled = false;
    btn.textContent = 'Verify →';
  }

  // ── Resend OTP code ───────────────────────────────────────────────────────
  async function resendOtpCode() {
    if (!otpMode) return;
    // Clear current digits
    for (let i = 0; i < 6; i++) {
      const d = document.getElementById('otp-d' + i);
      if (d) d.value = '';
    }
    updateOtpVerifyBtn();
    document.getElementById('otp-error-msg').classList.add('hidden');

    if (otpMode === 'email') {
      const email = document.getElementById('contact-email').value.trim();
      await fetch('/api/verify/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, session_token: checkoutToken })
      });
    } else {
      const phone = document.getElementById('contact-phone').value.trim();
      await fetch('/api/verify/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, session_token: checkoutToken })
      });
    }
    startResendTimer(60);
  }

  // ── Submit OTP code ───────────────────────────────────────────────────────
  async function submitOtpCode() {
    const code = getOtpCode();
    if (code.length < 6) return;

    const verifyBtn = document.getElementById('otp-verify-btn');
    const errMsg    = document.getElementById('otp-error-msg');
    const sucMsg    = document.getElementById('otp-success-msg');

    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>Verifying…';
    errMsg.classList.add('hidden');

    try {
      let res, data;
      if (otpMode === 'email') {
        const email = document.getElementById('contact-email').value.trim();
        res  = await fetch('/api/verify/email/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, session_token: checkoutToken, code })
        });
        data = await res.json();
      } else {
        const phone = document.getElementById('contact-phone').value.trim();
        res  = await fetch('/api/verify/phone/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, session_token: checkoutToken, code })
        });
        data = await res.json();
      }

      if (!res.ok) {
        errMsg.textContent = data.error || 'Incorrect code. Please try again.';
        errMsg.classList.remove('hidden');
        // Shake effect on wrong code
        const row = document.getElementById('otp-digit-row');
        row.style.animation = 'none';
        row.offsetHeight; // reflow
        row.style.animation = 'shake .35s ease';
        // Clear digits for re-entry
        for (let i = 0; i < 6; i++) {
          const d = document.getElementById('otp-d' + i);
          if (d) d.value = '';
        }
        document.getElementById('otp-d0')?.focus();
        updateOtpVerifyBtn();
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="fas fa-check mr-1.5"></i>Verify Code';
        return;
      }

      // ✅ Success
      sucMsg.textContent = otpMode === 'email'
        ? '✓ Email verified successfully!'
        : '✓ Phone number verified!';
      sucMsg.classList.remove('hidden');
      verifyBtn.innerHTML = '<i class="fas fa-check-circle mr-1.5"></i>Verified!';
      verifyBtn.className = verifyBtn.className.replace('bg-indigo-600','bg-green-600').replace('hover:bg-indigo-500','hover:bg-green-500');

      if (otpMode === 'email') {
        emailVerified = true;
        const badge = document.getElementById('email-verify-badge');
        const inp   = document.getElementById('contact-email');
        badge.classList.remove('hidden');
        inp.style.borderColor = 'rgba(34,197,94,.6)';
        document.getElementById('email-verify-btn').classList.add('hidden');
        const hint = document.getElementById('email-hint');
        hint.textContent = '✓ Email verified — confirmation will be sent here';
        hint.className = 'text-xs mt-1 text-green-400';
        hint.classList.remove('hidden');
      } else {
        phoneVerified = true;
        const badge = document.getElementById('phone-verify-badge');
        const inp   = document.getElementById('contact-phone');
        badge.classList.remove('hidden');
        inp.style.borderColor = 'rgba(34,197,94,.6)';
        document.getElementById('phone-verify-btn').classList.add('hidden');
        const hint = document.getElementById('phone-hint');
        hint.textContent = '✓ Phone verified — QR check-in link will be sent via SMS';
        hint.className = 'text-xs mt-1 text-green-400';
        hint.classList.remove('hidden');
      }

      setTimeout(closeOtpModal, 1400);
    } catch(e) {
      errMsg.textContent = 'Network error. Please check your connection and try again.';
      errMsg.classList.remove('hidden');
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = '<i class="fas fa-check mr-1.5"></i>Verify Code';
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════════════════
  loadListing();
  </script>
`

  return c.html(Layout('Checkout – ParkPeer', content, '', navSession))
})
