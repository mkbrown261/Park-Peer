// ════════════════════════════════════════════════════════════════════════════
// ParkPeer for Business — Frontend Pages
//   GET /business           → Landing page
//   GET /business/register  → Registration form
//   GET /business/dashboard → Full dashboard (auth required)
// ════════════════════════════════════════════════════════════════════════════
import { Hono } from 'hono'
import { verifyUserToken } from '../middleware/security'

type Bindings = {
  DB: D1Database
  USER_TOKEN_SECRET: string
}

export const businessPages = new Hono<{ Bindings: Bindings }>()

// ─────────────────────────────────────────────────────────────────────────────
// GET /business — Marketing / landing page
// ─────────────────────────────────────────────────────────────────────────────
businessPages.get('/', async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ParkPeer for Business — Parking Management at Scale</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            indigo:  { DEFAULT:'#5B2EFF', 500:'#5B2EFF', 600:'#4a20f0', 700:'#3a12d4' },
            lime:    { DEFAULT:'#C6FF00', 500:'#C6FF00', 600:'#a8d900' },
            charcoal:{ DEFAULT:'#121212', 100:'#1E1E1E', 200:'#2a2a2a', 300:'#3a3a3a' }
          },
          fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
        }
      }
    }
  </script>
  <style>
    body { background:#121212; color:#fff; font-family:'Inter',sans-serif; }
    .grad-text { background:linear-gradient(135deg,#5B2EFF,#C6FF00); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .card-glass { background:rgba(30,30,30,0.6); border:1px solid rgba(255,255,255,0.08); backdrop-filter:blur(8px); }
    .btn-primary { background:linear-gradient(135deg,#5B2EFF,#7B4FFF); transition:opacity .2s; }
    .btn-primary:hover { opacity:.9; }
    .btn-lime { background:#C6FF00; color:#121212; font-weight:700; transition:opacity .2s; }
    .btn-lime:hover { opacity:.9; }
    .feature-icon { background:linear-gradient(135deg,rgba(91,46,255,.2),rgba(198,255,0,.1)); border:1px solid rgba(91,46,255,.3); }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
    .float { animation:float 4s ease-in-out infinite; }
  </style>
</head>
<body>

<!-- ── Nav ─────────────────────────────────────────────────────────────────── -->
<nav class="fixed top-0 left-0 right-0 z-50" style="background:rgba(18,18,18,0.9);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.06);">
  <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
    <a href="/" class="flex items-center gap-2">
      <div class="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
        <i class="fas fa-parking text-white text-sm"></i>
      </div>
      <span class="font-black text-white">ParkPeer</span>
      <span class="ml-1 text-xs font-bold px-2 py-0.5 rounded-full bg-lime-500 text-charcoal">Business</span>
    </a>
    <div class="hidden md:flex items-center gap-8 text-sm text-white/60">
      <a href="#features" class="hover:text-white transition">Features</a>
      <a href="#pricing"  class="hover:text-white transition">Pricing</a>
      <a href="#how-it-works" class="hover:text-white transition">How It Works</a>
    </div>
    <div class="flex items-center gap-3">
      <a href="/business/dashboard" class="text-sm text-white/70 hover:text-white transition">Sign In</a>
      <a href="/business/register" class="btn-lime px-5 py-2 rounded-xl text-sm">Get Started Free</a>
    </div>
  </div>
</nav>

<!-- ── Hero ────────────────────────────────────────────────────────────────── -->
<section class="pt-32 pb-24 px-6 max-w-7xl mx-auto">
  <div class="text-center max-w-4xl mx-auto">
    <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-sm mb-8">
      <i class="fas fa-building text-xs"></i>
      <span>Enterprise Parking Management</span>
    </div>
    <h1 class="text-5xl md:text-7xl font-black leading-none mb-6">
      Parking Infrastructure<br/><span class="grad-text">at Scale</span>
    </h1>
    <p class="text-xl text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
      Manage multiple locations, track real-time occupancy, maximize revenue, and give your team role-based control — all from one dashboard.
    </p>
    <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
      <a href="/business/register" class="btn-primary px-8 py-4 rounded-2xl text-lg font-bold text-white flex items-center gap-2">
        <i class="fas fa-rocket"></i>Start Free Trial
      </a>
      <a href="#features" class="px-8 py-4 rounded-2xl text-lg font-medium text-white/70 border border-white/10 hover:border-white/30 transition flex items-center gap-2">
        <i class="fas fa-play-circle"></i>See How It Works
      </a>
    </div>
    <p class="text-white/30 text-sm mt-6">No credit card required · Setup in 5 minutes · Free for first 30 days</p>
  </div>

  <!-- Stats bar -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20">
    <div class="card-glass rounded-2xl p-6 text-center">
      <div class="text-3xl font-black text-lime-500 mb-1">500+</div>
      <div class="text-sm text-white/50">Business Locations</div>
    </div>
    <div class="card-glass rounded-2xl p-6 text-center">
      <div class="text-3xl font-black text-indigo-400 mb-1">$2.4M</div>
      <div class="text-sm text-white/50">Revenue Managed</div>
    </div>
    <div class="card-glass rounded-2xl p-6 text-center">
      <div class="text-3xl font-black text-lime-500 mb-1">98%</div>
      <div class="text-sm text-white/50">Uptime SLA</div>
    </div>
    <div class="card-glass rounded-2xl p-6 text-center">
      <div class="text-3xl font-black text-indigo-400 mb-1">24/7</div>
      <div class="text-sm text-white/50">Live Monitoring</div>
    </div>
  </div>
</section>

<!-- ── Features ─────────────────────────────────────────────────────────────── -->
<section id="features" class="py-24 px-6 max-w-7xl mx-auto">
  <div class="text-center mb-16">
    <h2 class="text-4xl font-black text-white mb-4">Everything Your Business Needs</h2>
    <p class="text-white/50 text-lg">Built for parking operators, commercial landlords, and fleet managers.</p>
  </div>

  <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
    ${[
      { icon:'fa-map-marked-alt', title:'Multi-Location Management', desc:'Manage unlimited parking locations from a single dashboard. View all properties, occupancy, and revenue at a glance.' },
      { icon:'fa-chart-line', title:'Real-Time Analytics', desc:'Revenue by day, occupancy rate, peak hours. Live data refreshes every 30 seconds so you always have the full picture.' },
      { icon:'fa-users-cog', title:'Role-Based Team Access', desc:'Admin, Manager, and Staff roles. Grant granular permissions — staff sees bookings, managers see analytics, admins control everything.' },
      { icon:'fa-bolt', title:'Live Booking Monitor', desc:'See every active booking across all locations in real time. Spot number, driver, time remaining, overstay alerts — all live.' },
      { icon:'fa-shield-alt', title:'Overstay Protection', desc:'Automatic overstay detection with instant host alerts. Resolve incidents with one click and maintain a paper trail.' },
      { icon:'fa-credit-card', title:'Stripe Connect Payouts', desc:'Automated daily payouts. Revenue flows directly to your business bank account. Full transaction history always available.' },
    ].map(f => `
    <div class="card-glass rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-300">
      <div class="feature-icon w-12 h-12 rounded-xl flex items-center justify-center mb-4">
        <i class="fas ${f.icon} text-indigo-400 text-lg"></i>
      </div>
      <h3 class="text-lg font-bold text-white mb-2">${f.title}</h3>
      <p class="text-white/50 text-sm leading-relaxed">${f.desc}</p>
    </div>`).join('')}
  </div>
</section>

<!-- ── How It Works ──────────────────────────────────────────────────────────── -->
<section id="how-it-works" class="py-24 px-6 max-w-4xl mx-auto">
  <div class="text-center mb-16">
    <h2 class="text-4xl font-black text-white mb-4">Up and Running in Minutes</h2>
  </div>
  <div class="space-y-6">
    ${[
      { n:1, title:'Register Your Business', desc:'Enter your company name, EIN, and business email. We verify your EIN within 1-2 business days.' },
      { n:2, title:'Add Your Locations', desc:'Add all your parking properties with addresses and coordinates. Create as many locations as you need.' },
      { n:3, title:'Configure Parking Spots', desc:'Map each physical spot with a number, type, and pricing. Link existing ParkPeer listings or create new ones.' },
      { n:4, title:'Invite Your Team', desc:'Add managers and staff members by email. Assign roles. Everyone gets instant access to their permission level.' },
      { n:5, title:'Go Live & Monitor', desc:'Publish your spots. Watch the Live Monitor update in real time as drivers book, arrive, and park.' },
    ].map(s => `
    <div class="card-glass rounded-2xl p-6 flex items-start gap-5">
      <div class="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-black text-lg">${s.n}</div>
      <div>
        <h3 class="text-base font-bold text-white mb-1">${s.title}</h3>
        <p class="text-white/50 text-sm leading-relaxed">${s.desc}</p>
      </div>
    </div>`).join('')}
  </div>
</section>

<!-- ── Pricing ───────────────────────────────────────────────────────────────── -->
<section id="pricing" class="py-24 px-6 max-w-5xl mx-auto">
  <div class="text-center mb-16">
    <h2 class="text-4xl font-black text-white mb-4">Simple, Transparent Pricing</h2>
    <p class="text-white/50">Pay only when you earn. No upfront fees.</p>
  </div>
  <div class="grid md:grid-cols-3 gap-6">
    ${[
      { name:'Starter', price:'Free', period:'Forever', features:['Up to 5 spots','1 location','1 team member','Basic analytics','Email support'], highlight:false },
      { name:'Growth', price:'$49', period:'/month + 3% revenue share', features:['Unlimited spots','Up to 10 locations','Up to 10 team members','Advanced analytics + charts','Live Monitor','Priority support'], highlight:true },
      { name:'Enterprise', price:'Custom', period:'Contact us', features:['Unlimited everything','White-label option','API access','Dedicated account manager','SLA guarantee','Custom integrations'], highlight:false },
    ].map(p => `
    <div class="card-glass rounded-2xl p-8 ${p.highlight ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : ''} relative">
      ${p.highlight ? '<div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-xs font-bold px-4 py-1 rounded-full">Most Popular</div>' : ''}
      <div class="text-white/50 text-sm font-medium mb-2">${p.name}</div>
      <div class="text-4xl font-black text-white mb-1">${p.price}</div>
      <div class="text-white/40 text-xs mb-6">${p.period}</div>
      <ul class="space-y-3 mb-8">
        ${p.features.map(f => `<li class="flex items-center gap-2 text-sm text-white/70"><i class="fas fa-check text-lime-500 text-xs"></i>${f}</li>`).join('')}
      </ul>
      <a href="${p.price === 'Custom' ? 'mailto:business@parkpeer.com' : '/business/register'}"
         class="${p.highlight ? 'btn-lime' : 'btn-primary text-white'} w-full py-3 rounded-xl text-sm font-bold text-center block">
        ${p.price === 'Custom' ? 'Contact Sales' : 'Get Started'}
      </a>
    </div>`).join('')}
  </div>
</section>

<!-- ── CTA ───────────────────────────────────────────────────────────────────── -->
<section class="py-24 px-6">
  <div class="max-w-3xl mx-auto card-glass rounded-3xl p-12 text-center">
    <h2 class="text-4xl font-black text-white mb-4">Ready to Scale Your Parking?</h2>
    <p class="text-white/50 mb-8">Join hundreds of businesses managing their parking with ParkPeer.</p>
    <a href="/business/register" class="btn-lime inline-flex items-center gap-2 px-10 py-4 rounded-2xl text-lg font-black">
      <i class="fas fa-building"></i>Register Your Business
    </a>
  </div>
</section>

<footer class="border-t border-white/5 py-10 px-6 text-center text-white/30 text-sm">
  <p>&copy; 2026 ParkPeer Inc. · <a href="/legal/tos" class="hover:text-white/60 transition">Terms</a> · <a href="/legal/privacy" class="hover:text-white/60 transition">Privacy</a></p>
</footer>
</body>
</html>`)
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /business/register — Registration form
// ─────────────────────────────────────────────────────────────────────────────
businessPages.get('/register', async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Register Your Business — ParkPeer</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <script>tailwind.config={theme:{extend:{colors:{indigo:{DEFAULT:'#5B2EFF',500:'#5B2EFF',600:'#4a20f0'},lime:{DEFAULT:'#C6FF00'},charcoal:{DEFAULT:'#121212',100:'#1E1E1E',200:'#2a2a2a'}},fontFamily:{sans:['Inter','system-ui','sans-serif']}}}}</script>
  <style>
    body{background:#121212;color:#fff;font-family:'Inter',sans-serif;}
    .glass{background:rgba(30,30,30,0.7);border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(12px);}
    .input-field{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:.75rem;padding:.75rem 1rem;width:100%;outline:none;transition:border-color .2s,background .2s;}
    .input-field:focus{border-color:#5B2EFF;background:rgba(91,46,255,0.08);}
    .input-field::placeholder{color:rgba(255,255,255,.3);}
    .btn-primary{background:linear-gradient(135deg,#5B2EFF,#7B4FFF);color:#fff;border:none;cursor:pointer;transition:opacity .2s;}
    .btn-primary:hover{opacity:.9;}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;}
    label{font-size:.8rem;font-weight:600;color:rgba(255,255,255,.6);margin-bottom:.3rem;display:block;}
  </style>
</head>
<body class="min-h-screen flex flex-col">
<nav style="background:rgba(18,18,18,0.9);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.06);" class="px-6 py-4 flex items-center justify-between">
  <a href="/business" class="flex items-center gap-2">
    <div class="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center"><i class="fas fa-parking text-white text-sm"></i></div>
    <span class="font-black text-white">ParkPeer</span>
    <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-lime-500 text-charcoal ml-1">Business</span>
  </a>
  <a href="/auth/login" class="text-sm text-white/50 hover:text-white transition">Already have an account?</a>
</nav>

<div class="flex-1 flex items-center justify-center px-4 py-12">
  <div class="w-full max-w-lg">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-black text-white mb-2">Register Your Business</h1>
      <p class="text-white/50 text-sm">Takes about 5 minutes. EIN verification within 1-2 business days.</p>
    </div>

    <div class="glass rounded-3xl p-8">
      <!-- Progress Steps -->
      <div class="flex items-center gap-2 mb-8">
        <div id="step-dot-1" class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">1</div>
          <span class="text-xs text-white/60 hidden sm:block">Company Info</span>
        </div>
        <div class="flex-1 h-px bg-white/10"></div>
        <div class="flex items-center gap-2">
          <div id="step-dot-2" class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/40 text-xs font-bold">2</div>
          <span class="text-xs text-white/30 hidden sm:block">Contact & Address</span>
        </div>
        <div class="flex-1 h-px bg-white/10"></div>
        <div class="flex items-center gap-2">
          <div id="step-dot-3" class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/40 text-xs font-bold">3</div>
          <span class="text-xs text-white/30 hidden sm:block">Review & Submit</span>
        </div>
      </div>

      <!-- Error/Success banners -->
      <div id="error-banner" class="hidden bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm mb-6"></div>
      <div id="success-banner" class="hidden bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm mb-6"></div>

      <!-- Step 1: Company Info -->
      <div id="step-1">
        <div class="space-y-4">
          <div>
            <label>Company Name *</label>
            <input id="company_name" class="input-field" placeholder="Acme Parking LLC" maxlength="100"/>
          </div>
          <div>
            <label>Employer Identification Number (EIN) *</label>
            <input id="ein" class="input-field" placeholder="12-3456789" maxlength="10"/>
            <p class="text-xs text-white/30 mt-1">Format: XX-XXXXXXX. This will be verified.</p>
          </div>
          <div>
            <label>Industry</label>
            <select id="industry" class="input-field" style="background:rgba(255,255,255,0.06);">
              <option value="" style="background:#1e1e1e">Select industry…</option>
              <option value="parking_operator" style="background:#1e1e1e">Parking Operator</option>
              <option value="commercial_real_estate" style="background:#1e1e1e">Commercial Real Estate</option>
              <option value="hotel_hospitality" style="background:#1e1e1e">Hotel / Hospitality</option>
              <option value="shopping_center" style="background:#1e1e1e">Shopping Center / Retail</option>
              <option value="sports_entertainment" style="background:#1e1e1e">Sports & Entertainment</option>
              <option value="corporate" style="background:#1e1e1e">Corporate Office</option>
              <option value="airport" style="background:#1e1e1e">Airport / Transit</option>
              <option value="other" style="background:#1e1e1e">Other</option>
            </select>
          </div>
        </div>
        <button onclick="goStep(2)" class="btn-primary w-full py-3 rounded-xl font-bold mt-6">Continue <i class="fas fa-arrow-right ml-1"></i></button>
      </div>

      <!-- Step 2: Contact & Address -->
      <div id="step-2" class="hidden">
        <div class="space-y-4">
          <div>
            <label>Business Email *</label>
            <input id="business_email" class="input-field" type="email" placeholder="admin@yourcompany.com"/>
          </div>
          <div>
            <label>Business Phone</label>
            <input id="business_phone" class="input-field" type="tel" placeholder="+1 (312) 555-0100"/>
          </div>
          <div>
            <label>Business Address</label>
            <input id="business_address" class="input-field" placeholder="123 Main Street"/>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-1">
              <label>City</label>
              <input id="business_city" class="input-field" placeholder="Chicago"/>
            </div>
            <div>
              <label>State</label>
              <input id="business_state" class="input-field" placeholder="IL" maxlength="2"/>
            </div>
            <div>
              <label>ZIP</label>
              <input id="business_zip" class="input-field" placeholder="60601" maxlength="10"/>
            </div>
          </div>
          <div>
            <label>Website (optional)</label>
            <input id="website" class="input-field" type="url" placeholder="https://yourcompany.com"/>
          </div>
        </div>
        <div class="flex gap-3 mt-6">
          <button onclick="goStep(1)" class="flex-1 py-3 rounded-xl font-bold border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </button>
          <button onclick="goStep(3)" class="flex-1 btn-primary py-3 rounded-xl font-bold">
            Review <i class="fas fa-arrow-right ml-1"></i>
          </button>
        </div>
      </div>

      <!-- Step 3: Review & Submit -->
      <div id="step-3" class="hidden">
        <div class="space-y-3 mb-6">
          <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wide">Review Your Information</h3>
          <div id="review-card" class="bg-white/5 rounded-2xl p-5 space-y-2 text-sm">
            <!-- populated by JS -->
          </div>
          <p class="text-xs text-white/30 leading-relaxed">
            By submitting, you agree to ParkPeer's <a href="/legal/tos" class="text-indigo-400 hover:underline">Terms of Service</a> and
            <a href="/legal/privacy" class="text-indigo-400 hover:underline">Privacy Policy</a>.
            Your EIN will be verified before your account is activated.
          </p>
        </div>
        <div class="flex gap-3">
          <button onclick="goStep(2)" class="flex-1 py-3 rounded-xl font-bold border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition">
            <i class="fas fa-arrow-left mr-1"></i> Edit
          </button>
          <button id="submit-btn" onclick="submitRegistration()" class="flex-1 btn-primary py-3 rounded-xl font-bold">
            <i class="fas fa-check mr-1"></i> Submit Application
          </button>
        </div>
      </div>
    </div>

    <p class="text-center text-white/30 text-xs mt-6">
      Already have a ParkPeer account? Your business account will be linked to it.
    </p>
  </div>
</div>

<script>
  let currentStep = 1

  function goStep(n) {
    // Validate before advancing
    if (n > currentStep) {
      if (currentStep === 1) {
        if (!document.getElementById('company_name').value.trim()) { showError('Company name is required'); return }
        const ein = document.getElementById('ein').value.replace(/\\D/g,'')
        if (ein.length !== 9) { showError('EIN must be 9 digits (format: XX-XXXXXXX)'); return }
      }
      if (currentStep === 2) {
        const email = document.getElementById('business_email').value.trim()
        if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { showError('Valid business email required'); return }
      }
    }
    hideError()
    document.getElementById('step-' + currentStep).classList.add('hidden')
    document.getElementById('step-' + n).classList.remove('hidden')
    currentStep = n

    // Update dots
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById('step-dot-' + i)
      if (!dot) continue
      if (i < n) {
        dot.className = 'w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold'
        dot.innerHTML = '<i class="fas fa-check text-xs"></i>'
      } else if (i === n) {
        dot.className = 'w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold'
        dot.innerHTML = i
      } else {
        dot.className = 'w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/40 text-xs font-bold'
        dot.innerHTML = i
      }
    }

    if (n === 3) buildReviewCard()
  }

  function buildReviewCard() {
    const fields = [
      ['Company Name', document.getElementById('company_name').value],
      ['EIN', document.getElementById('ein').value],
      ['Industry', document.getElementById('industry').value.replace(/_/g,' ')],
      ['Business Email', document.getElementById('business_email').value],
      ['Phone', document.getElementById('business_phone').value || '—'],
      ['Address', [
        document.getElementById('business_address').value,
        document.getElementById('business_city').value,
        document.getElementById('business_state').value,
        document.getElementById('business_zip').value
      ].filter(Boolean).join(', ') || '—'],
      ['Website', document.getElementById('website').value || '—'],
    ]
    document.getElementById('review-card').innerHTML = fields.map(([k,v]) =>
      \`<div class="flex justify-between gap-4"><span class="text-white/40">\${k}</span><span class="text-white font-medium text-right">\${v}</span></div>\`
    ).join('')
  }

  function showError(msg) {
    const el = document.getElementById('error-banner')
    el.textContent = msg
    el.classList.remove('hidden')
    setTimeout(() => el.classList.add('hidden'), 4000)
  }
  function hideError() { document.getElementById('error-banner').classList.add('hidden') }

  async function submitRegistration() {
    const btn = document.getElementById('submit-btn')
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Submitting…'

    const token = localStorage.getItem('pp_token') || sessionStorage.getItem('pp_token') || ''
    if (!token) {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-check mr-1"></i> Submit Application'
      showError('You must be logged in to register a business. Please log in first.')
      setTimeout(() => {
        window.location.href = '/auth/login?reason=auth&next=' + encodeURIComponent('/business/register')
      }, 2000)
      return
    }

    const payload = {
      company_name:     document.getElementById('company_name').value.trim(),
      ein:              document.getElementById('ein').value.trim(),
      industry:         document.getElementById('industry').value,
      business_email:   document.getElementById('business_email').value.trim(),
      business_phone:   document.getElementById('business_phone').value.trim() || undefined,
      business_address: document.getElementById('business_address').value.trim() || undefined,
      business_city:    document.getElementById('business_city').value.trim() || undefined,
      business_state:   document.getElementById('business_state').value.trim() || undefined,
      business_zip:     document.getElementById('business_zip').value.trim() || undefined,
      website:          document.getElementById('website').value.trim() || undefined,
    }

    try {
      const res  = await fetch('/api/business/register', {
        method:  'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
        body:    JSON.stringify(payload)
      })
      const data = await res.json()

      if (res.ok && data.success) {
        const sb = document.getElementById('success-banner')
        sb.innerHTML = \`<i class="fas fa-check-circle mr-2"></i> Application submitted! Your business <strong>\${data.company_name}</strong> is pending verification. We'll email you within 1-2 business days.\`
        sb.classList.remove('hidden')
        document.getElementById('step-3').innerHTML = \`
          <div class="text-center py-8">
            <div class="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-green-400">
              <i class="fas fa-check text-green-400 text-3xl"></i>
            </div>
            <h3 class="text-xl font-black text-white mb-2">Application Received!</h3>
            <p class="text-white/60 text-sm mb-6">We'll verify your EIN and activate your account within 1-2 business days.</p>
            <a href="/business/dashboard" class="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white">
              <i class="fas fa-tachometer-alt"></i>Go to Dashboard
            </a>
          </div>\`
      } else {
        btn.disabled = false
        btn.innerHTML = '<i class="fas fa-check mr-1"></i> Submit Application'
        showError(data.error || 'Registration failed. Please try again.')
      }
    } catch {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-check mr-1"></i> Submit Application'
      showError('Network error. Please try again.')
    }
  }

  // EIN auto-format
  document.addEventListener('DOMContentLoaded', () => {
    const einInput = document.getElementById('ein')
    einInput.addEventListener('input', () => {
      let v = einInput.value.replace(/\\D/g,'')
      if (v.length > 2) v = v.slice(0,2) + '-' + v.slice(2,9)
      einInput.value = v
    })
  })
</script>
</body>
</html>`)
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /business/dashboard — Full business management dashboard
// ─────────────────────────────────────────────────────────────────────────────
businessPages.get('/dashboard', async (c) => {
  const session = await verifyUserToken(
    c, c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  ).catch(() => null)

  if (!session) {
    return c.redirect(`/auth/login?reason=auth&next=${encodeURIComponent('/business/dashboard')}`)
  }

  const db = c.env?.DB
  if (!db) return c.text('Service unavailable', 503)

  // Check if user has a business account
  const biz = await db.prepare(`
    SELECT ba.*, bu.role AS user_role
    FROM business_accounts ba
    LEFT JOIN business_users bu ON ba.id = bu.business_id AND bu.user_id = ?
    WHERE ba.owner_user_id = ? OR bu.user_id = ?
    LIMIT 1
  `).bind(session.userId, session.userId, session.userId).first<any>()

  // If no business, redirect to registration
  if (!biz) {
    return c.redirect('/business/register')
  }

  const effectiveRole = biz.owner_user_id === session.userId ? 'admin' : (biz.user_role || 'staff')
  const isAdmin       = effectiveRole === 'admin'
  const isManager     = ['admin','manager'].includes(effectiveRole)
  const verStatus     = biz.verification_status

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${biz.company_name} — Business Dashboard</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script>tailwind.config={theme:{extend:{colors:{indigo:{DEFAULT:'#5B2EFF',500:'#5B2EFF',600:'#4a20f0',700:'#3a12d4'},lime:{DEFAULT:'#C6FF00',500:'#C6FF00'},charcoal:{DEFAULT:'#121212',100:'#1E1E1E',200:'#2a2a2a',300:'#3a3a3a',400:'#4a4a4a'}},fontFamily:{sans:['Inter','system-ui','sans-serif']}}}}</script>
  <style>
    body{background:#121212;color:#fff;font-family:'Inter',sans-serif;}
    .glass{background:rgba(30,30,30,0.7);border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);}
    .card{background:#1E1E1E;border:1px solid rgba(255,255,255,0.06);border-radius:1rem;}
    .btn-primary{background:linear-gradient(135deg,#5B2EFF,#7B4FFF);color:#fff;border:none;cursor:pointer;transition:opacity .2s;}
    .btn-primary:hover{opacity:.9;}
    .btn-danger{background:rgba(239,68,68,.1);color:#f87171;border:1px solid rgba(239,68,68,.3);cursor:pointer;transition:all .2s;}
    .btn-danger:hover{background:rgba(239,68,68,.2);}
    .tab-btn{padding:.5rem 1rem;border-radius:.75rem;font-size:.875rem;font-weight:600;cursor:pointer;transition:all .2s;color:rgba(255,255,255,.5);}
    .tab-btn.active{background:rgba(91,46,255,.2);color:#7B4FFF;border:1px solid rgba(91,46,255,.3);}
    .tab-btn:not(.active):hover{color:#fff;}
    .input-field{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:.75rem;padding:.6rem .9rem;outline:none;transition:border-color .2s;}
    .input-field:focus{border-color:#5B2EFF;}
    .input-field::placeholder{color:rgba(255,255,255,.3);}
    label{font-size:.75rem;font-weight:600;color:rgba(255,255,255,.5);margin-bottom:.25rem;display:block;}
    .status-verified{background:rgba(34,197,94,.1);color:#4ade80;border:1px solid rgba(34,197,94,.3);}
    .status-pending{background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.3);}
    .status-rejected{background:rgba(239,68,68,.1);color:#f87171;border:1px solid rgba(239,68,68,.3);}
    .role-admin{background:rgba(91,46,255,.1);color:#a78bfa;}
    .role-manager{background:rgba(34,197,94,.1);color:#4ade80;}
    .role-staff{background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);}
    .live-dot::before{content:'';display:inline-block;width:8px;height:8px;background:#C6FF00;border-radius:50%;margin-right:6px;animation:pulse 1.5s ease-in-out infinite;}
    @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
    ::-webkit-scrollbar{width:6px;height:6px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px;}
  </style>
</head>
<body class="min-h-screen">

<!-- ── Sidebar ─────────────────────────────────────────────────────────────── -->
<div class="fixed left-0 top-0 bottom-0 w-64 glass z-40 flex flex-col" id="sidebar">
  <!-- Logo -->
  <div class="px-5 py-5 border-b border-white/5">
    <a href="/business" class="flex items-center gap-2">
      <div class="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
        <i class="fas fa-building text-white text-sm"></i>
      </div>
      <div>
        <div class="text-white font-black text-sm leading-tight">${biz.company_name.length > 18 ? biz.company_name.slice(0,18)+'…' : biz.company_name}</div>
        <div class="text-xs mt-0.5">
          <span class="px-1.5 py-0.5 rounded-full text-xs font-medium status-${verStatus}">${verStatus}</span>
        </div>
      </div>
    </a>
  </div>

  <!-- Nav -->
  <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
    <button onclick="showTab('overview')" id="nav-overview" class="tab-btn active w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-chart-pie w-4"></i>Overview
    </button>
    <button onclick="showTab('monitor')"  id="nav-monitor"  class="tab-btn w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-circle w-4 text-lime-500"></i><span class="live-dot">Live Monitor</span>
    </button>
    ${isManager ? `
    <button onclick="showTab('locations')" id="nav-locations" class="tab-btn w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-map-marker-alt w-4"></i>Locations
    </button>
    <button onclick="showTab('spots')"     id="nav-spots"     class="tab-btn w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-parking w-4"></i>Spots
    </button>
    <button onclick="showTab('analytics')" id="nav-analytics" class="tab-btn w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-chart-line w-4"></i>Analytics
    </button>` : ''}
    ${isAdmin ? `
    <button onclick="showTab('team')"      id="nav-team"      class="tab-btn w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-users w-4"></i>Team
    </button>
    <button onclick="showTab('settings')"  id="nav-settings"  class="tab-btn w-full flex items-center gap-3 text-left px-3">
      <i class="fas fa-cog w-4"></i>Settings
    </button>` : ''}
  </nav>

  <!-- Footer -->
  <div class="px-4 py-4 border-t border-white/5 space-y-2">
    <a href="/host" class="flex items-center gap-2 text-sm text-white/50 hover:text-white transition px-1">
      <i class="fas fa-home text-xs w-4"></i>Host Dashboard
    </a>
    <a href="/dashboard" class="flex items-center gap-2 text-sm text-white/50 hover:text-white transition px-1">
      <i class="fas fa-car text-xs w-4"></i>Driver Dashboard
    </a>
    <div class="px-1 pt-2">
      <div class="text-xs text-white/30">Logged in as</div>
      <div class="text-sm text-white/70 font-medium truncate">${session.email || 'User'}</div>
      <div class="text-xs mt-0.5 inline-flex px-1.5 py-0.5 rounded-full font-medium role-${effectiveRole}">${effectiveRole}</div>
    </div>
  </div>
</div>

<!-- ── Main Content ────────────────────────────────────────────────────────── -->
<div class="ml-64 min-h-screen p-6">

  <!-- ── OVERVIEW TAB ──────────────────────────────────────────────────────── -->
  <div id="tab-overview" class="tab-content">
    <div class="mb-6">
      <h1 class="text-2xl font-black text-white">Dashboard Overview</h1>
      <p class="text-white/40 text-sm mt-1">Welcome back. Here's your business at a glance.</p>
    </div>

    ${verStatus !== 'verified' ? `
    <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 mb-6 flex items-start gap-3">
      <i class="fas fa-clock text-yellow-400 mt-0.5"></i>
      <div>
        <p class="text-yellow-400 font-semibold text-sm">Account Pending Verification</p>
        <p class="text-white/50 text-xs mt-0.5">Your EIN is being verified. Full access unlocks within 1-2 business days. You can still set up your locations and spots.</p>
      </div>
    </div>` : ''}

    <!-- KPI Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" id="kpi-cards">
      <div class="card p-5">
        <div class="text-white/40 text-xs font-semibold uppercase tracking-wide mb-2">Total Spots</div>
        <div class="text-3xl font-black text-white" id="kpi-spots">—</div>
        <div class="text-white/30 text-xs mt-1">across all locations</div>
      </div>
      <div class="card p-5">
        <div class="text-white/40 text-xs font-semibold uppercase tracking-wide mb-2">Active Bookings</div>
        <div class="text-3xl font-black text-indigo-400" id="kpi-active">—</div>
        <div class="text-white/30 text-xs mt-1">right now</div>
      </div>
      <div class="card p-5">
        <div class="text-white/40 text-xs font-semibold uppercase tracking-wide mb-2">Monthly Revenue</div>
        <div class="text-3xl font-black text-lime-500" id="kpi-revenue">—</div>
        <div class="text-white/30 text-xs mt-1">last 30 days</div>
      </div>
      <div class="card p-5">
        <div class="text-white/40 text-xs font-semibold uppercase tracking-wide mb-2">Utilization Rate</div>
        <div class="text-3xl font-black text-white" id="kpi-util">—</div>
        <div class="text-white/30 text-xs mt-1" id="kpi-locations">— locations</div>
      </div>
    </div>

    <!-- Revenue Chart -->
    <div class="card p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-white">Revenue — Last 14 Days</h2>
        <span class="text-xs text-white/30">Updated live</span>
      </div>
      <canvas id="revenue-chart" height="80"></canvas>
    </div>
  </div>

  <!-- ── LIVE MONITOR TAB ───────────────────────────────────────────────────── -->
  <div id="tab-monitor" class="tab-content hidden">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-black text-white flex items-center gap-2">
          <span class="live-dot"></span>Live Monitor
        </h1>
        <p class="text-white/40 text-sm mt-1">All active bookings across your locations. Updates every 30 seconds.</p>
      </div>
      <button onclick="loadLiveMonitor()" class="btn-primary px-4 py-2 rounded-xl text-sm font-semibold">
        <i class="fas fa-sync-alt mr-1"></i>Refresh
      </button>
    </div>

    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-white/5">
            <th class="text-left px-4 py-3 text-white/40 font-semibold text-xs uppercase tracking-wide">Spot</th>
            <th class="text-left px-4 py-3 text-white/40 font-semibold text-xs uppercase tracking-wide">Driver</th>
            <th class="text-left px-4 py-3 text-white/40 font-semibold text-xs uppercase tracking-wide hidden md:table-cell">Start Time</th>
            <th class="text-left px-4 py-3 text-white/40 font-semibold text-xs uppercase tracking-wide hidden md:table-cell">End Time</th>
            <th class="text-left px-4 py-3 text-white/40 font-semibold text-xs uppercase tracking-wide">Time Remaining</th>
            <th class="text-left px-4 py-3 text-white/40 font-semibold text-xs uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody id="monitor-tbody">
          <tr><td colspan="6" class="text-center py-10 text-white/30">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <p class="text-xs text-white/20 mt-3 text-right" id="monitor-last-updated"></p>
  </div>

  <!-- ── LOCATIONS TAB ─────────────────────────────────────────────────────── -->
  <div id="tab-locations" class="tab-content hidden">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-black text-white">Locations</h1>
        <p class="text-white/40 text-sm mt-1">Manage your parking properties.</p>
      </div>
      ${isManager ? `<button onclick="openAddLocation()" class="btn-primary px-4 py-2 rounded-xl text-sm font-semibold"><i class="fas fa-plus mr-1"></i>Add Location</button>` : ''}
    </div>
    <div id="locations-list" class="grid md:grid-cols-2 gap-4">
      <div class="card p-8 text-center text-white/30">Loading…</div>
    </div>
  </div>

  <!-- ── SPOTS TAB ─────────────────────────────────────────────────────────── -->
  <div id="tab-spots" class="tab-content hidden">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-black text-white">Parking Spots</h1>
        <p class="text-white/40 text-sm mt-1">Configure individual spots per location.</p>
      </div>
      <div class="flex items-center gap-3">
        <select id="spot-location-filter" onchange="loadSpots()" class="input-field text-sm">
          <option value="">All Locations</option>
        </select>
        ${isManager ? `<button onclick="openAddSpot()" class="btn-primary px-4 py-2 rounded-xl text-sm font-semibold"><i class="fas fa-plus mr-1"></i>Add Spot</button>` : ''}
      </div>
    </div>
    <div id="spots-list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div class="card p-8 text-center text-white/30">Select a location to view spots.</div>
    </div>
  </div>

  <!-- ── ANALYTICS TAB ─────────────────────────────────────────────────────── -->
  <div id="tab-analytics" class="tab-content hidden">
    <div class="mb-6">
      <h1 class="text-2xl font-black text-white">Analytics</h1>
      <p class="text-white/40 text-sm mt-1">Revenue, occupancy, and peak hours.</p>
    </div>
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="card p-6">
        <h3 class="font-bold text-white mb-4">Revenue by Day</h3>
        <canvas id="analytics-revenue-chart" height="120"></canvas>
      </div>
      <div class="card p-6">
        <h3 class="font-bold text-white mb-4">Occupancy Rate</h3>
        <canvas id="analytics-occupancy-chart" height="120"></canvas>
      </div>
    </div>
  </div>

  <!-- ── TEAM TAB ───────────────────────────────────────────────────────────── -->
  <div id="tab-team" class="tab-content hidden">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-black text-white">Team Management</h1>
        <p class="text-white/40 text-sm mt-1">Control who has access and what they can do.</p>
      </div>
      ${isAdmin ? `<button onclick="openInviteModal()" class="btn-primary px-4 py-2 rounded-xl text-sm font-semibold"><i class="fas fa-user-plus mr-1"></i>Invite Member</button>` : ''}
    </div>

    <!-- Role legend -->
    <div class="flex gap-3 mb-5 flex-wrap">
      <div class="card px-4 py-2 flex items-center gap-2 text-sm">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium role-admin">Admin</span>
        <span class="text-white/40">Full control</span>
      </div>
      <div class="card px-4 py-2 flex items-center gap-2 text-sm">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium role-manager">Manager</span>
        <span class="text-white/40">Listings + analytics</span>
      </div>
      <div class="card px-4 py-2 flex items-center gap-2 text-sm">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium role-staff">Staff</span>
        <span class="text-white/40">View bookings only</span>
      </div>
    </div>

    <div id="team-list" class="space-y-3">
      <div class="card p-8 text-center text-white/30">Loading team…</div>
    </div>
  </div>

  <!-- ── SETTINGS TAB ───────────────────────────────────────────────────────── -->
  <div id="tab-settings" class="tab-content hidden">
    <div class="mb-6">
      <h1 class="text-2xl font-black text-white">Business Settings</h1>
      <p class="text-white/40 text-sm mt-1">Update your company profile and account details.</p>
    </div>
    <div class="max-w-lg space-y-4">
      <div class="card p-6">
        <h3 class="font-bold text-white mb-4">Company Profile</h3>
        <div class="space-y-4">
          <div>
            <label>Company Name</label>
            <input id="set-company" class="input-field w-full" value="${biz.company_name}"/>
          </div>
          <div>
            <label>Business Email</label>
            <input id="set-email" class="input-field w-full" type="email" value="${biz.business_email}"/>
          </div>
          <div>
            <label>Business Phone</label>
            <input id="set-phone" class="input-field w-full" type="tel" value="${biz.business_phone || ''}"/>
          </div>
          <div>
            <label>Website</label>
            <input id="set-website" class="input-field w-full" type="url" value="${biz.website || ''}"/>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label>City</label>
              <input id="set-city" class="input-field w-full" value="${biz.business_city || ''}"/>
            </div>
            <div>
              <label>State</label>
              <input id="set-state" class="input-field w-full" value="${biz.business_state || ''}"/>
            </div>
          </div>
        </div>
        <button onclick="saveSettings()" class="btn-primary w-full py-2.5 rounded-xl text-sm font-bold mt-5">Save Changes</button>
      </div>

      <div class="card p-6">
        <h3 class="font-bold text-white mb-2">Account Info</h3>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-white/40">EIN</span><span class="text-white font-mono">${biz.ein.slice(0,2)+'-'+biz.ein.slice(2)}</span></div>
          <div class="flex justify-between"><span class="text-white/40">Status</span><span class="px-2 py-0.5 rounded-full text-xs font-medium status-${verStatus}">${verStatus}</span></div>
          <div class="flex justify-between"><span class="text-white/40">Member since</span><span class="text-white">${new Date(biz.created_at).toLocaleDateString()}</span></div>
          <div class="flex justify-between"><span class="text-white/40">Your role</span><span class="px-2 py-0.5 rounded-full text-xs font-medium role-${effectiveRole}">${effectiveRole}</span></div>
        </div>
      </div>
    </div>
  </div>

</div><!-- /main content -->

<!-- ── Modals ─────────────────────────────────────────────────────────────── -->

<!-- Add Location Modal -->
<div id="modal-location" class="hidden fixed inset-0 z-50 flex items-center justify-center px-4" style="background:rgba(0,0,0,.7)">
  <div class="glass rounded-3xl p-7 w-full max-w-md">
    <h3 class="text-lg font-bold text-white mb-5">Add New Location</h3>
    <div class="space-y-3">
      <div><label>Location Name *</label><input id="loc-name" class="input-field w-full" placeholder="Downtown Parking Lot A"/></div>
      <div><label>Address *</label><input id="loc-address" class="input-field w-full" placeholder="100 W Madison St"/></div>
      <div class="grid grid-cols-3 gap-2">
        <div><label>City</label><input id="loc-city" class="input-field w-full" placeholder="Chicago"/></div>
        <div><label>State</label><input id="loc-state" class="input-field w-full" placeholder="IL" maxlength="2"/></div>
        <div><label>ZIP</label><input id="loc-zip" class="input-field w-full" placeholder="60601"/></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label>Latitude</label><input id="loc-lat" class="input-field w-full" type="number" step="any" placeholder="41.8781"/></div>
        <div><label>Longitude</label><input id="loc-lng" class="input-field w-full" type="number" step="any" placeholder="-87.6298"/></div>
      </div>
    </div>
    <div id="modal-loc-error" class="hidden text-red-400 text-xs mt-2"></div>
    <div class="flex gap-3 mt-5">
      <button onclick="closeModal('modal-location')" class="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 hover:text-white transition font-semibold">Cancel</button>
      <button onclick="submitLocation()" class="flex-1 btn-primary py-2.5 rounded-xl font-bold">Add Location</button>
    </div>
  </div>
</div>

<!-- Add Spot Modal -->
<div id="modal-spot" class="hidden fixed inset-0 z-50 flex items-center justify-center px-4" style="background:rgba(0,0,0,.7)">
  <div class="glass rounded-3xl p-7 w-full max-w-md">
    <h3 class="text-lg font-bold text-white mb-5">Add New Spot</h3>
    <div class="space-y-3">
      <div>
        <label>Location *</label>
        <select id="spot-loc-select" class="input-field w-full" style="background:rgba(255,255,255,.06)"></select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label>Spot Number *</label><input id="spot-number" class="input-field w-full" placeholder="A-01"/></div>
        <div>
          <label>Type</label>
          <select id="spot-type" class="input-field w-full" style="background:rgba(255,255,255,.06)">
            <option value="standard" style="background:#1e1e1e">Standard</option>
            <option value="compact"  style="background:#1e1e1e">Compact</option>
            <option value="oversized"style="background:#1e1e1e">Oversized</option>
            <option value="ev"       style="background:#1e1e1e">EV Charging</option>
            <option value="accessible" style="background:#1e1e1e">Accessible</option>
            <option value="reserved" style="background:#1e1e1e">Reserved</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div><label>Hourly ($)</label><input id="spot-hourly" class="input-field w-full" type="number" step="0.5" min="0" placeholder="3.00"/></div>
        <div><label>Daily ($)</label><input id="spot-daily"  class="input-field w-full" type="number" step="1" min="0" placeholder="20"/></div>
        <div><label>Monthly ($)</label><input id="spot-monthly" class="input-field w-full" type="number" step="5" min="0" placeholder="150"/></div>
      </div>
    </div>
    <div id="modal-spot-error" class="hidden text-red-400 text-xs mt-2"></div>
    <div class="flex gap-3 mt-5">
      <button onclick="closeModal('modal-spot')" class="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 hover:text-white transition font-semibold">Cancel</button>
      <button onclick="submitSpot()" class="flex-1 btn-primary py-2.5 rounded-xl font-bold">Add Spot</button>
    </div>
  </div>
</div>

<!-- Invite Team Member Modal -->
<div id="modal-invite" class="hidden fixed inset-0 z-50 flex items-center justify-center px-4" style="background:rgba(0,0,0,.7)">
  <div class="glass rounded-3xl p-7 w-full max-w-md">
    <h3 class="text-lg font-bold text-white mb-5">Invite Team Member</h3>
    <div class="space-y-3">
      <div><label>Email Address *</label><input id="invite-email" class="input-field w-full" type="email" placeholder="manager@yourcompany.com"/></div>
      <div>
        <label>Role *</label>
        <select id="invite-role" class="input-field w-full" style="background:rgba(255,255,255,.06)">
          <option value="staff"   style="background:#1e1e1e">Staff — View active bookings only</option>
          <option value="manager" style="background:#1e1e1e">Manager — Manage listings + analytics</option>
          <option value="admin"   style="background:#1e1e1e">Admin — Full control</option>
        </select>
      </div>
    </div>
    <div id="modal-invite-error" class="hidden text-red-400 text-xs mt-2"></div>
    <div id="modal-invite-success" class="hidden text-green-400 text-xs mt-2"></div>
    <div class="flex gap-3 mt-5">
      <button onclick="closeModal('modal-invite')" class="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 hover:text-white transition font-semibold">Cancel</button>
      <button onclick="submitInvite()" class="flex-1 btn-primary py-2.5 rounded-xl font-bold">Send Invite</button>
    </div>
  </div>
</div>

<!-- ── JavaScript ─────────────────────────────────────────────────────────── -->
<script>
  const token = localStorage.getItem('pp_token') || sessionStorage.getItem('pp_token') || ''
  const authH = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }

  // ── Tab navigation ─────────────────────────────────────────────────────
  function showTab(name) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'))
    document.getElementById('tab-' + name)?.classList.remove('hidden')
    document.querySelectorAll('[id^="nav-"]').forEach(el => el.classList.remove('active'))
    document.getElementById('nav-' + name)?.classList.add('active')

    // Lazy load tab data
    if (name === 'overview')   loadDashboard()
    if (name === 'monitor')    loadLiveMonitor()
    if (name === 'locations')  loadLocations()
    if (name === 'spots')      loadAllLocationsForFilter()
    if (name === 'team')       loadTeam()
    if (name === 'analytics')  loadAnalytics()
  }

  // ── Dashboard KPIs ─────────────────────────────────────────────────────
  let revenueChart = null
  async function loadDashboard() {
    try {
      const r = await fetch('/api/business/dashboard', { headers: authH })
      if (!r.ok) return
      const d = await r.json()
      const k = d.kpis || {}
      document.getElementById('kpi-spots').textContent   = k.total_spots ?? '—'
      document.getElementById('kpi-active').textContent  = k.active_bookings ?? '—'
      document.getElementById('kpi-revenue').textContent = '$' + (k.monthly_revenue ?? '0.00')
      document.getElementById('kpi-util').textContent    = (k.utilization_rate ?? 0) + '%'
      document.getElementById('kpi-locations').textContent = (k.total_locations ?? 0) + ' locations'

      const revData = d.charts?.revenue_by_day || []
      const labels  = revData.map(r => r.day?.slice(5) || '')
      const values  = revData.map(r => parseFloat(r.revenue) || 0)

      if (revenueChart) { revenueChart.destroy() }
      const ctx = document.getElementById('revenue-chart')?.getContext('2d')
      if (ctx) {
        revenueChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [{ label:'Revenue ($)', data: values, backgroundColor:'rgba(91,46,255,0.6)', borderColor:'#5B2EFF', borderWidth:1, borderRadius:6 }]
          },
          options: { responsive:true, plugins:{ legend:{ display:false } }, scales: { x:{ticks:{color:'rgba(255,255,255,.4)',font:{size:11}}}, y:{ticks:{color:'rgba(255,255,255,.4)',font:{size:11}},beginAtZero:true} } }
        })
      }
    } catch {}
  }

  // ── Live Monitor ───────────────────────────────────────────────────────
  let monitorInterval = null
  async function loadLiveMonitor() {
    try {
      const r = await fetch('/api/business/live-monitor', { headers: authH })
      const d = await r.json()
      const tbody = document.getElementById('monitor-tbody')
      const bookings = d.active_bookings || []

      if (!bookings.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-white/30"><i class="fas fa-parking text-2xl mb-2 block opacity-30"></i>No active bookings right now</td></tr>'
        return
      }

      tbody.innerHTML = bookings.map(b => {
        const endMs   = new Date(b.end_time).getTime()
        const remS    = Math.max(0, Math.floor((endMs - Date.now()) / 1000))
        const h = Math.floor(remS/3600), m = Math.floor((remS%3600)/60), s = remS%60
        const timeStr = [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')
        const isOver  = b.is_overstayed || remS <= 0
        const statusCls = isOver ? 'text-red-400 bg-red-500/10' : 'text-green-400 bg-green-500/10'
        const statusTxt = isOver ? 'OVERSTAYED' : 'ACTIVE'
        return \`<tr class="border-b border-white/5 hover:bg-white/2 transition">
          <td class="px-4 py-3 font-medium text-white">\${b.spot_number || b.spot_name || '—'}</td>
          <td class="px-4 py-3">
            <div class="text-white text-sm font-medium">\${b.driver_name}</div>
            <div class="text-white/40 text-xs">\${b.vehicle_plate || ''}</div>
          </td>
          <td class="px-4 py-3 text-white/60 text-sm hidden md:table-cell">\${new Date(b.start_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
          <td class="px-4 py-3 text-white/60 text-sm hidden md:table-cell">\${new Date(b.end_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
          <td class="px-4 py-3 font-mono text-sm font-bold \${isOver ? 'text-red-400' : 'text-lime-400'}" id="timer-\${b.id}" data-end="\${endMs}">\${timeStr}</td>
          <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs font-bold \${statusCls}">\${statusTxt}</span></td>
        </tr>\`
      }).join('')

      document.getElementById('monitor-last-updated').textContent = 'Last updated: ' + new Date().toLocaleTimeString()
    } catch {}
  }

  // Live timer tick for monitor table
  setInterval(() => {
    document.querySelectorAll('[id^="timer-"][data-end]').forEach(el => {
      const endMs = parseInt(el.dataset.end)
      const remS  = Math.max(0, Math.floor((endMs - Date.now()) / 1000))
      const h = Math.floor(remS/3600), m = Math.floor((remS%3600)/60), s = remS%60
      el.textContent = [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')
      if (remS <= 0) { el.classList.add('text-red-400'); el.classList.remove('text-lime-400') }
    })
  }, 1000)

  // Auto-refresh monitor every 30s
  setInterval(() => {
    const monitorTab = document.getElementById('tab-monitor')
    if (!monitorTab?.classList.contains('hidden')) loadLiveMonitor()
  }, 30000)

  // ── Locations ──────────────────────────────────────────────────────────
  let locationsData = []
  async function loadLocations() {
    try {
      const r = await fetch('/api/business/locations', { headers: authH })
      const d = await r.json()
      locationsData = d.locations || []
      const container = document.getElementById('locations-list')
      if (!locationsData.length) {
        container.innerHTML = \`
          <div class="card p-10 text-center col-span-2">
            <i class="fas fa-map-marker-alt text-3xl text-white/20 mb-3 block"></i>
            <p class="text-white/40 mb-4">No locations yet. Add your first parking property.</p>
            <button onclick="openAddLocation()" class="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold">Add Location</button>
          </div>\`
        return
      }
      container.innerHTML = locationsData.map(loc => \`
        <div class="card p-5 hover:border-indigo-500/20 transition">
          <div class="flex items-start justify-between mb-3">
            <div>
              <h3 class="font-bold text-white">\${loc.name}</h3>
              <p class="text-sm text-white/40 mt-0.5">\${loc.address}, \${loc.city}, \${loc.state}</p>
            </div>
            <span class="px-2 py-0.5 rounded-full text-xs font-medium \${loc.active ? 'text-green-400 bg-green-500/10' : 'text-white/30 bg-white/5'}">\${loc.active ? 'Active' : 'Inactive'}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-1 text-white/50"><i class="fas fa-parking text-xs"></i><span>\${loc.spot_count || 0} spots</span></div>
            <button onclick="viewSpots(\${loc.id})" class="text-indigo-400 hover:text-indigo-300 transition text-xs font-semibold">View Spots <i class="fas fa-arrow-right"></i></button>
          </div>
        </div>\`).join('')
    } catch {}
  }

  async function loadAllLocationsForFilter() {
    try {
      const r = await fetch('/api/business/locations', { headers: authH })
      const d = await r.json()
      locationsData = d.locations || []
      const sel = document.getElementById('spot-location-filter')
      const sel2 = document.getElementById('spot-loc-select')
      const opts = locationsData.map(l => \`<option value="\${l.id}" style="background:#1e1e1e">\${l.name}</option>\`).join('')
      sel.innerHTML  = '<option value="">All Locations</option>' + opts
      if (sel2) sel2.innerHTML = '<option value="">Select location…</option>' + opts
    } catch {}
  }

  function viewSpots(locId) {
    showTab('spots')
    setTimeout(() => {
      const sel = document.getElementById('spot-location-filter')
      if (sel) { sel.value = locId; loadSpots() }
    }, 200)
  }

  async function loadSpots() {
    const locId = document.getElementById('spot-location-filter')?.value
    if (!locId) { document.getElementById('spots-list').innerHTML = '<div class="card p-8 text-center text-white/30 col-span-3">Select a location to view spots.</div>'; return }
    try {
      const r = await fetch(\`/api/business/locations/\${locId}/spots\`, { headers: authH })
      const d = await r.json()
      const spots = d.spots || []
      const container = document.getElementById('spots-list')
      if (!spots.length) {
        container.innerHTML = '<div class="card p-8 text-center text-white/30 col-span-3">No spots yet for this location.</div>'
        return
      }
      const typeColors = { standard:'text-white/60', ev:'text-lime-400', accessible:'text-blue-400', oversized:'text-yellow-400', compact:'text-purple-400', reserved:'text-orange-400' }
      container.innerHTML = spots.map(s => \`
        <div class="card p-4 hover:border-indigo-500/20 transition">
          <div class="flex items-center justify-between mb-2">
            <span class="text-lg font-black text-white">\${s.spot_number}</span>
            <span class="px-2 py-0.5 rounded-full text-xs font-medium \${typeColors[s.spot_type]||'text-white/50'} bg-white/5">\${s.spot_type}</span>
          </div>
          <div class="text-sm text-white/40 space-y-0.5">
            \${s.price_hourly ? '<div>$'+s.price_hourly+'/hr</div>' : ''}
            \${s.price_daily  ? '<div>$'+s.price_daily+'/day</div>': ''}
            \${s.price_monthly? '<div>$'+s.price_monthly+'/mo</div>': ''}
          </div>
          <div class="mt-3">
            <span class="px-2 py-0.5 rounded-full text-xs font-medium \${s.status==='available'?'text-green-400 bg-green-500/10':s.status==='occupied'?'text-red-400 bg-red-500/10':'text-white/40 bg-white/5'}">\${s.status}</span>
          </div>
        </div>\`).join('')
    } catch {}
  }

  // ── Team ────────────────────────────────────────────────────────────────
  async function loadTeam() {
    try {
      const r = await fetch('/api/business/users', { headers: authH })
      const d = await r.json()
      const team = d.team || []
      const container = document.getElementById('team-list')
      if (!team.length) { container.innerHTML = '<div class="card p-8 text-center text-white/30">No team members yet.</div>'; return }
      container.innerHTML = team.map(m => \`
        <div class="card p-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 font-bold text-sm flex-shrink-0">
              \${(m.full_name||'U')[0].toUpperCase()}
            </div>
            <div>
              <div class="text-sm font-semibold text-white">\${m.full_name}</div>
              <div class="text-xs text-white/40">\${m.email}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-full text-xs font-medium role-\${m.role}">\${m.role}</span>
            <button onclick="removeMember(\${m.user_id})" class="w-8 h-8 rounded-lg btn-danger flex items-center justify-center text-xs" title="Remove">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>\`).join('')
    } catch {}
  }

  // ── Analytics ──────────────────────────────────────────────────────────
  let analyticsCharts = {}
  async function loadAnalytics() {
    try {
      const r = await fetch('/api/business/dashboard', { headers: authH })
      const d = await r.json()
      const revData = d.charts?.revenue_by_day || []

      if (analyticsCharts.rev) analyticsCharts.rev.destroy()
      const ctx1 = document.getElementById('analytics-revenue-chart')?.getContext('2d')
      if (ctx1) {
        analyticsCharts.rev = new Chart(ctx1, {
          type: 'line',
          data: {
            labels: revData.map(r => r.day?.slice(5)),
            datasets: [{ label:'Revenue ($)', data: revData.map(r => parseFloat(r.revenue)||0),
              borderColor:'#5B2EFF', backgroundColor:'rgba(91,46,255,0.1)', fill:true, tension:.4 }]
          },
          options: { responsive:true, plugins:{ legend:{ labels:{ color:'rgba(255,255,255,.5)' } } },
            scales:{ x:{ticks:{color:'rgba(255,255,255,.4)'}}, y:{ticks:{color:'rgba(255,255,255,.4)'},beginAtZero:true} } }
        })
      }

      // Occupancy doughnut
      const k = d.kpis || {}
      const occ = k.utilization_rate || 0
      if (analyticsCharts.occ) analyticsCharts.occ.destroy()
      const ctx2 = document.getElementById('analytics-occupancy-chart')?.getContext('2d')
      if (ctx2) {
        analyticsCharts.occ = new Chart(ctx2, {
          type:'doughnut',
          data:{ labels:['Occupied','Available'], datasets:[{ data:[occ,100-occ], backgroundColor:['#5B2EFF','rgba(255,255,255,.1)'], borderWidth:0 }] },
          options:{ cutout:'70%', plugins:{ legend:{ labels:{ color:'rgba(255,255,255,.5)' } } } }
        })
      }
    } catch {}
  }

  // ── Modals & forms ─────────────────────────────────────────────────────
  function openAddLocation()  { document.getElementById('modal-location').classList.remove('hidden') }
  function openAddSpot()      { loadAllLocationsForFilter(); document.getElementById('modal-spot').classList.remove('hidden') }
  function openInviteModal()  { document.getElementById('modal-invite').classList.remove('hidden') }
  function closeModal(id)     { document.getElementById(id).classList.add('hidden') }

  async function submitLocation() {
    const payload = {
      name:    document.getElementById('loc-name').value.trim(),
      address: document.getElementById('loc-address').value.trim(),
      city:    document.getElementById('loc-city').value.trim(),
      state:   document.getElementById('loc-state').value.trim(),
      zip:     document.getElementById('loc-zip').value.trim(),
      lat:     parseFloat(document.getElementById('loc-lat').value) || undefined,
      lng:     parseFloat(document.getElementById('loc-lng').value) || undefined,
    }
    if (!payload.name || !payload.address || !payload.city || !payload.state) {
      document.getElementById('modal-loc-error').textContent = 'Name, address, city, state are required'
      document.getElementById('modal-loc-error').classList.remove('hidden')
      return
    }
    try {
      const r = await fetch('/api/business/locations', { method:'POST', headers: authH, body: JSON.stringify(payload) })
      const d = await r.json()
      if (d.success) { closeModal('modal-location'); loadLocations() }
      else { document.getElementById('modal-loc-error').textContent = d.error||'Error'; document.getElementById('modal-loc-error').classList.remove('hidden') }
    } catch {}
  }

  async function submitSpot() {
    const locId = document.getElementById('spot-loc-select').value
    if (!locId) { document.getElementById('modal-spot-error').textContent = 'Select a location'; document.getElementById('modal-spot-error').classList.remove('hidden'); return }
    const payload = {
      spot_number:  document.getElementById('spot-number').value.trim(),
      spot_type:    document.getElementById('spot-type').value,
      price_hourly: parseFloat(document.getElementById('spot-hourly').value)||undefined,
      price_daily:  parseFloat(document.getElementById('spot-daily').value)||undefined,
      price_monthly:parseFloat(document.getElementById('spot-monthly').value)||undefined,
    }
    if (!payload.spot_number) { document.getElementById('modal-spot-error').textContent = 'Spot number required'; document.getElementById('modal-spot-error').classList.remove('hidden'); return }
    try {
      const r = await fetch(\`/api/business/locations/\${locId}/spots\`, { method:'POST', headers: authH, body: JSON.stringify(payload) })
      const d = await r.json()
      if (d.success) { closeModal('modal-spot'); loadSpots() }
      else { document.getElementById('modal-spot-error').textContent = d.error||'Error'; document.getElementById('modal-spot-error').classList.remove('hidden') }
    } catch {}
  }

  async function submitInvite() {
    const email = document.getElementById('invite-email').value.trim()
    const role  = document.getElementById('invite-role').value
    if (!email) return
    try {
      const r = await fetch('/api/business/users/invite', { method:'POST', headers: authH, body: JSON.stringify({ email, role }) })
      const d = await r.json()
      const errEl = document.getElementById('modal-invite-error')
      const sucEl = document.getElementById('modal-invite-success')
      if (d.success) {
        sucEl.textContent = email + ' added as ' + role
        sucEl.classList.remove('hidden')
        errEl.classList.add('hidden')
        setTimeout(() => { closeModal('modal-invite'); loadTeam() }, 1500)
      } else {
        errEl.textContent = d.error || 'Error inviting user'
        errEl.classList.remove('hidden')
        sucEl.classList.add('hidden')
      }
    } catch {}
  }

  async function removeMember(userId) {
    if (!confirm('Remove this team member?')) return
    try {
      const r = await fetch('/api/business/users/' + userId, { method:'DELETE', headers: authH })
      const d = await r.json()
      if (d.success) loadTeam()
      else alert(d.error || 'Could not remove member')
    } catch {}
  }

  async function saveSettings() {
    const payload = {
      company_name:     document.getElementById('set-company').value.trim(),
      business_email:   document.getElementById('set-email').value.trim(),
      business_phone:   document.getElementById('set-phone').value.trim() || undefined,
      website:          document.getElementById('set-website').value.trim() || undefined,
      business_city:    document.getElementById('set-city').value.trim() || undefined,
      business_state:   document.getElementById('set-state').value.trim() || undefined,
    }
    try {
      const r = await fetch('/api/business/me', { method:'PUT', headers: authH, body: JSON.stringify(payload) })
      const d = await r.json()
      alert(d.success ? 'Settings saved!' : (d.error || 'Save failed'))
    } catch { alert('Network error') }
  }

  // ── Init ────────────────────────────────────────────────────────────────
  loadDashboard()
</script>
</body>
</html>`)
})
