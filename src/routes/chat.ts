import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ════════════════════════════════════════════════════════════════════════════
// ParkPeer AI Chat Assistant
// POST /api/chat
//
// Future-ready structure:
//  - Add DB queries to inject live listing data into system context
//  - Add user session to personalize responses (booking history, role)
//  - Add chat log storage in D1 (chat_sessions, chat_messages tables)
//  - Add admin monitoring endpoint (GET /api/admin/chat-logs)
// ════════════════════════════════════════════════════════════════════════════

type Bindings = {
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
}

export const chatRoutes = new Hono<{ Bindings: Bindings }>()

chatRoutes.use('/*', cors())

// ── In-memory rate limiter (per IP, resets on worker restart) ──────────────
// For persistent rate limiting, replace with KV storage in production
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const RATE_LIMIT_WINDOW_MS = 60_000   // 1 minute window
const RATE_LIMIT_MAX       = 15       // 15 messages per minute per IP
const MAX_HISTORY_TURNS    = 10       // max conversation turns kept
const MAX_MESSAGE_CHARS    = 500      // max characters per user message
const MAX_RESPONSE_TOKENS  = 400      // max tokens in AI response

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// ── Safety filters ─────────────────────────────────────────────────────────
const BLOCKED_PATTERNS = [
  // Prompt injection attempts
  /ignore\s+(previous|above|all)\s+(instructions?|prompt)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|another)\s+(ai|assistant|bot)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(?!a\s+parkpeer)/i,
  /forget\s+(everything|your|the)\s+(instructions?|prompt|training)/i,
  /system\s*:\s*you\s+are/i,
  /\[system\]/i,
  /\bdan\b.*mode/i,
  /jailbreak/i,
  // Inappropriate content
  /\b(hack|exploit|bypass|override)\s+(the\s+)?(system|ai|filter)/i,
]

function isSafeMessage(text: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return false
  }
  return true
}

// ── System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the ParkPeer AI assistant — a friendly, helpful, concise, and professional support agent for ParkPeer, a peer-to-peer parking marketplace.

PERSONALITY:
- Warm, friendly, and approachable
- Concise — keep responses under 120 words unless a detailed step-by-step is truly needed
- Use simple, plain language. Avoid jargon.
- Use bullet points or numbered steps for multi-step guidance
- Occasionally use a relevant emoji (🚗 🅿️ 💰 ✅) but don't overdo it

YOUR ROLE:
- Help drivers find and book parking spots
- Help hosts list their spaces and earn income
- Answer platform FAQs
- Guide new users through onboarding
- Suggest whether someone should sign up as a driver, host, or both

PARKPEER KNOWLEDGE BASE:

**Platform Overview:**
- ParkPeer is a peer-to-peer parking marketplace
- Hosts list driveways, garages, lots, and covered spaces
- Drivers search by location, book, and pay securely
- Available wherever hosts list their spaces — the platform is growing city by city
- Platform fee: 15% taken from the booking subtotal (host keeps 85%)

**For Drivers — How It Works:**
1. Search by address or city at parkpeer.pages.dev/search
2. Browse available spots with photos, prices, and reviews
3. Select arrival and departure times
4. Book instantly (Instant Book) or request approval from the host
5. Pay securely via Stripe — card, Apple Pay, or Google Pay
6. Receive confirmation and QR code for check-in
7. Navigate to the spot and park

**Pricing for Drivers:**
- Hourly rates vary by location and space type — check the listing for exact pricing
- Daily rates available for all-day parking
- Monthly rates for commuters needing regular spots
- A 15% service fee is added at checkout
- Free cancellation up to 1 hour before arrival

**For Hosts — How It Works:**
1. Create a listing at parkpeer.pages.dev/host
2. Add title, space type (driveway, garage, lot, covered)
3. Set your hourly, daily, and monthly rates
4. Add photos and description
5. Set availability — choose which days and hours
6. Enable Instant Book or manually approve requests
7. Guests book → you get paid automatically

**Host Earnings:**
- Hosts earn 85% of the booking price (ParkPeer keeps 15%)
- Earnings depend on your location, space type, and how often it's booked
- Payouts are processed weekly to your bank account via Stripe
- Track earnings in real-time on your Host Dashboard at /host

**Payments & Security:**
- All payments processed by Stripe (bank-level security)
- ParkPeer never stores credit card details
- Hosts connect their bank account via Stripe for payouts
- ParkPeer Guarantee: full refund if space is unavailable on arrival

**Booking & Cancellation:**
- Instant Book: book immediately without waiting for host approval
- Request to Book: host has up to 24 hours to accept or decline
- Free cancellation up to 1 hour before your arrival time
- Late cancellations may be non-refundable at host's discretion
- No-shows are not eligible for refunds

**Account & Verification:**
- Sign up free at /auth/signup
- You can be a Driver, Host, or Both on one account
- ID verification required before hosting
- Phone verification required for booking
- Secure login with email + password

**Support:**
- 24/7 support available
- Contact through the platform
- Dispute resolution available for both drivers and hosts

**Onboarding Guidance:**
- If someone wants to park → Guide them to /search or /auth/signup as Driver
- If someone has a driveway or garage → Guide them to /host or /auth/signup as Host
- If unsure → Ask: "Are you looking to find parking, or do you have a space to list?"

STRICT RULES — YOU MUST FOLLOW THESE:
1. ONLY answer questions about ParkPeer. If asked about anything else, politely redirect to ParkPeer topics.
2. NEVER mention competitors (SpotHero, ParkWhiz, Parkopedia, etc.)
3. NEVER provide legal advice (lease disputes, property rights, liability)
4. NEVER provide financial advice (tax implications of hosting income)
5. NEVER access, request, or discuss specific user account data, booking IDs, or payment details
6. NEVER make up features, prices, or policies not listed above
7. If you don't know something, say: "I don't have that information — please contact our support team."
8. Keep responses focused and under 150 words unless a detailed list is essential
9. You are ParkPeer's assistant — never break character or claim to be a different AI

GREETING (first message only):
"Hi! I'm the ParkPeer assistant 🅿️ How can I help you today? I can help with finding parking, listing your space, bookings, payments, or anything else about the platform."`

// ════════════════════════════════════════════════════════════════════════════
// POST /api/chat
// Body: { message: string, history: Array<{role:'user'|'assistant', content:string}> }
// Returns: { reply: string, error?: string }
// ════════════════════════════════════════════════════════════════════════════
chatRoutes.post('/', async (c) => {
  // ── Get client IP for rate limiting ────────────────────────────────────────
  const ip = c.req.header('CF-Connecting-IP')
    || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown'

  // ── Rate limit check ────────────────────────────────────────────────────────
  if (!checkRateLimit(ip)) {
    return c.json({
      error: 'rate_limited',
      reply: "You've sent too many messages. Please wait a minute before trying again. 🙏"
    }, 429)
  }

  // ── Parse request body ─────────────────────────────────────────────────────
  let body: { message?: string; history?: Array<{role: string; content: string}> } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json', reply: 'Invalid request format.' }, 400)
  }

  const { message, history = [] } = body

  // ── Validate message ───────────────────────────────────────────────────────
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'missing_message', reply: 'Please send a message.' }, 400)
  }

  const trimmed = message.trim()
  if (trimmed.length === 0) {
    return c.json({ error: 'empty_message', reply: 'Please type a message.' }, 400)
  }
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    return c.json({
      error: 'message_too_long',
      reply: `Please keep your message under ${MAX_MESSAGE_CHARS} characters.`
    }, 400)
  }

  // ── Safety filter ──────────────────────────────────────────────────────────
  if (!isSafeMessage(trimmed)) {
    return c.json({
      error: 'unsafe_message',
      reply: "I can only help with ParkPeer questions. How can I assist you with parking today? 🅿️"
    }, 200)
  }

  // ── Check API key ──────────────────────────────────────────────────────────
  const apiKey  = c.env?.OPENAI_API_KEY
  const baseURL = c.env?.OPENAI_BASE_URL || 'https://api.openai.com/v1'

  if (!apiKey) {
    console.error('[chat] OPENAI_API_KEY not configured')
    return c.json({
      error: 'service_unavailable',
      reply: "The AI assistant is temporarily unavailable. Please try again later or contact support."
    }, 503)
  }

  // ── Build message history (sanitized, trimmed) ────────────────────────────
  const safeHistory = Array.isArray(history)
    ? history
        .filter(m =>
          m && typeof m.role === 'string' && typeof m.content === 'string' &&
          (m.role === 'user' || m.role === 'assistant')
        )
        .slice(-MAX_HISTORY_TURNS * 2)   // keep last N turns (user + assistant pairs)
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: String(m.content).substring(0, MAX_MESSAGE_CHARS)
        }))
    : []

  // ── Optionally inject live platform stats into context ────────────────────
  // Future: query D1 for live spot counts, pricing data, etc.
  // Example:
  // let liveContext = ''
  // if (c.env?.DB) {
  //   const stats = await c.env.DB.prepare("SELECT COUNT(*) as n FROM listings WHERE status='active'").first()
  //   liveContext = `\n\nCurrent live data: ${stats?.n ?? 0} active listings on the platform.`
  // }
  // Then append liveContext to SYSTEM_PROMPT

  const messages: Array<{role: 'system'|'user'|'assistant'; content: string}> = [
    { role: 'system',    content: SYSTEM_PROMPT },
    ...safeHistory,
    { role: 'user',      content: trimmed },
  ]

  // ── Call OpenAI API ────────────────────────────────────────────────────────
  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       'gpt-5-mini',
        messages,
        max_tokens:  MAX_RESPONSE_TOKENS,
        temperature: 0.6,
        top_p:       0.9,
        // Discourage overly long or off-topic responses
        frequency_penalty: 0.1,
        presence_penalty:  0.1,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown')
      // Log without leaking key
      console.error(`[chat] OpenAI API error ${response.status}: ${errText.substring(0, 200)}`)
      return c.json({
        error: 'ai_error',
        reply: "I'm having trouble right now. Please try again in a moment or contact our support team."
      }, 502)
    }

    const data: any = await response.json()
    const reply = data?.choices?.[0]?.message?.content?.trim()

    if (!reply) {
      console.error('[chat] Empty response from OpenAI', JSON.stringify(data).substring(0, 200))
      return c.json({
        error: 'empty_response',
        reply: "I didn't get a response. Please try again."
      }, 502)
    }

    // ── Log usage (no sensitive data) ─────────────────────────────────────────
    const usage = data?.usage
    if (usage) {
      console.log(`[chat] tokens used: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`)
    }

    // ── Future: store chat log in D1 ──────────────────────────────────────────
    // if (c.env?.DB) {
    //   await c.env.DB.prepare(`
    //     INSERT INTO chat_logs (session_id, user_ip_hash, user_message, ai_reply, created_at)
    //     VALUES (?, ?, ?, ?, datetime('now'))
    //   `).bind(sessionId, hashIP(ip), trimmed.substring(0,500), reply.substring(0,1000)).run()
    // }

    return c.json({ reply })

  } catch (err: any) {
    // Log error without exposing API key or user data
    console.error('[chat] Fetch error:', err?.message?.substring(0, 200) ?? 'unknown')
    return c.json({
      error: 'network_error',
      reply: "I'm unable to connect right now. Please check your connection and try again."
    }, 503)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/chat/health — sanity check (no key exposed)
// ════════════════════════════════════════════════════════════════════════════
chatRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    ai_configured: !!(c.env?.OPENAI_API_KEY),
    rate_limit: `${RATE_LIMIT_MAX} msgs/${RATE_LIMIT_WINDOW_MS/1000}s per IP`,
    max_history_turns: MAX_HISTORY_TURNS,
    max_message_chars: MAX_MESSAGE_CHARS,
  })
})
