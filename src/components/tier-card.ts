/**
 * TierCard — shared HTML component for driver and host tier display.
 * Renders the full tier status card including:
 *  - Current tier badge with gradient
 *  - Progress bar to next tier
 *  - Metric gaps (what's needed to reach next tier)
 *  - Active benefits list
 *  - Loyalty credits balance
 *  - Working "Refresh Tier" button that calls /api/tiers/recalculate
 *
 * Called server-side with pre-fetched tier state.
 */

export interface TierCardData {
  role:            'DRIVER' | 'HOST'
  current_tier:    string
  tier_name:       string
  tier_tagline:    string
  tier_since?:     string
  tier_gradient:   string
  tier_icon:       string
  tier_rank:       number
  progress_to_next: number          // 0.0 – 1.0
  is_max_tier:     boolean
  next_tier?:      { id: string; name: string; icon: string } | null
  benefits: {
    fee_discount_pct:     number
    priority_access:      boolean
    instant_confirm:      boolean
    listing_boost:        boolean
    featured_eligible:    boolean
    support_priority:     string
    analytics_unlocked:   boolean
    early_feature_access: boolean
    monthly_credits:      number
  }
  metrics: {
    r12_completed:     number
    r12_spend?:        number
    r12_revenue?:      number
    r12_avg_rating:    number
    r12_cancel_rate:   number
    lifetime_completed: number
  }
  gaps: Array<{
    metric:       string
    current:      string | number
    required:     string | number
    unit:         string
    pct_complete: number
  }>
  loyalty_credits:    number
  is_protected:       boolean
  grace_period_ends?: string | null
  consecutive_months: number
}

// Color maps per tier
const TIER_COLORS: Record<string, { text: string; bg: string; border: string; bar: string }> = {
  nomad:    { text: 'text-gray-300',    bg: 'bg-gray-500/10',    border: 'border-gray-500/20',    bar: 'bg-gray-400' },
  cruiser:  { text: 'text-indigo-300',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/20',  bar: 'bg-indigo-400' },
  vaulted:  { text: 'text-violet-300',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  bar: 'bg-violet-400' },
  apex:     { text: 'text-lime-300',    bg: 'bg-lime-500/10',    border: 'border-lime-500/20',    bar: 'bg-lime-400' },
  steward:  { text: 'text-gray-300',    bg: 'bg-gray-500/10',    border: 'border-gray-500/20',    bar: 'bg-gray-400' },
  curator:  { text: 'text-blue-300',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    bar: 'bg-blue-400' },
  prestige: { text: 'text-violet-300',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  bar: 'bg-violet-400' },
  icon:     { text: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   bar: 'bg-amber-400' },
}

function tierColors(tierId: string) {
  return TIER_COLORS[tierId] || TIER_COLORS['steward']
}

function benefitRow(icon: string, label: string, active: boolean, value?: string) {
  if (!active) return ''
  return `
    <div class="flex items-center gap-2.5 py-1.5">
      <div class="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
        <i class="fas ${icon} text-indigo-400 text-xs"></i>
      </div>
      <span class="text-gray-300 text-xs flex-1">${label}</span>
      ${value ? `<span class="text-indigo-300 text-xs font-semibold">${value}</span>` : ''}
    </div>`
}

export function renderTierCard(data: TierCardData): string {
  const colors    = tierColors(data.current_tier)
  const pct       = Math.round(data.progress_to_next * 100)
  const b         = data.benefits
  const tierSince = data.tier_since
    ? new Date(data.tier_since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  // Unique card ID so multiple cards on the same page work
  const cardId = `tier-card-${data.role.toLowerCase()}-${Date.now()}`

  // Grace period warning banner
  const graceBanner = data.is_protected && data.grace_period_ends ? `
    <div class="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2">
      <i class="fas fa-clock text-amber-400 text-xs flex-shrink-0"></i>
      <p class="text-amber-300 text-xs">
        <strong>Status protected</strong> — 30-day grace period active until
        ${new Date(data.grace_period_ends).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        Maintain your metrics to keep your tier.
      </p>
    </div>` : ''

  // Benefits list
  const benefitsHTML = [
    b.fee_discount_pct > 0
      ? benefitRow('fa-percent', 'Platform fee discount', true, `-${(b.fee_discount_pct * 100).toFixed(0)}%`)
      : '',
    benefitRow('fa-bolt', 'Priority spot access', b.priority_access),
    benefitRow('fa-check-circle', 'Instant booking confirm', b.instant_confirm),
    benefitRow('fa-arrow-up', 'Search listing boost', b.listing_boost),
    benefitRow('fa-star', 'Featured placement eligible', b.featured_eligible),
    benefitRow('fa-chart-bar', 'Advanced analytics', b.analytics_unlocked),
    benefitRow('fa-headset', 'Priority support',
      b.support_priority !== 'standard', b.support_priority === 'dedicated' ? 'Dedicated' : 'Priority'),
    benefitRow('fa-flask', 'Early feature access', b.early_feature_access),
    b.monthly_credits > 0
      ? benefitRow('fa-coins', 'Monthly loyalty credits', true, `+$${b.monthly_credits}/mo`)
      : '',
  ].filter(Boolean).join('')

  const noBenefits = benefitsHTML.trim() === ''
    ? `<p class="text-gray-500 text-xs italic py-2">You're on the base tier — complete bookings and earn ratings to unlock benefits.</p>`
    : ''

  // Progress section
  const progressSection = data.is_max_tier
    ? `<div class="text-center py-3">
        <i class="fas fa-crown text-amber-400 text-lg mb-1 block"></i>
        <p class="text-xs text-gray-400">You've reached the top tier. Thank you for being an elite host!</p>
      </div>`
    : `<div class="mb-4">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-gray-400">Progress to
            <span class="font-semibold ${colors.text}">${data.next_tier?.name || 'next tier'}</span>
          </span>
          <span class="text-xs font-bold ${pct >= 80 ? 'text-lime-400' : pct >= 50 ? 'text-indigo-400' : 'text-gray-400'}">${pct}%</span>
        </div>
        <div class="w-full h-2 bg-white/5 rounded-full overflow-hidden">
          <div class="${colors.bar} h-full rounded-full transition-all duration-700"
               style="width: ${Math.max(pct, 2)}%"></div>
        </div>
        ${data.gaps.length > 0 ? `
        <div class="mt-3 space-y-2">
          ${data.gaps.slice(0, 3).map(g => `
            <div>
              <div class="flex justify-between mb-0.5">
                <span class="text-gray-500 text-xs">${g.metric}</span>
                <span class="text-gray-400 text-xs">${g.current} / ${g.required} ${g.unit}</span>
              </div>
              <div class="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500 ${g.pct_complete >= 100 ? 'bg-green-500' : colors.bar}"
                     style="width: ${Math.min(g.pct_complete, 100)}%"></div>
              </div>
            </div>`).join('')}
        </div>` : `<p class="text-gray-600 text-xs mt-2">Keep earning to progress!</p>`}
      </div>`

  // Revenue stat (host only)
  const revenueStatCell = data.role === 'HOST' && (data.metrics.r12_revenue ?? 0) >= 0
    ? `<div class="text-center">
        <p class="text-white font-bold text-sm">$${((data.metrics.r12_revenue ?? 0)).toFixed(0)}</p>
        <p class="text-gray-500 text-xs">revenue (12mo)</p>
      </div>`
    : `<div class="text-center">
        <p class="text-white font-bold text-sm">${data.metrics.lifetime_completed}</p>
        <p class="text-gray-500 text-xs">lifetime bookings</p>
      </div>`

  return `
  <div id="${cardId}" class="bg-charcoal-100 rounded-2xl border ${colors.border} overflow-hidden">

    <!-- Tier Header -->
    <div class="relative p-5 pb-4" style="background: ${data.tier_gradient}22">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
               style="background: ${data.tier_gradient}">
            <i class="fas ${data.tier_icon} text-white text-lg"></i>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-black text-white text-lg leading-tight">${data.tier_name}</h3>
              <span class="text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} ${colors.border} border font-medium">
                ${data.role === 'DRIVER' ? 'Driver' : 'Host'}
              </span>
            </div>
            <p class="text-xs text-gray-400 mt-0.5 italic">${data.tier_tagline}</p>
          </div>
        </div>

        <!-- Refresh button + credits -->
        <div class="flex flex-col items-end gap-1.5">
          <button id="${cardId}-refresh-btn"
            onclick="(function(btn){
              btn.disabled = true;
              var icon = btn.querySelector('i');
              if(icon){ icon.classList.add('fa-spin'); }
              var statusEl = document.getElementById('${cardId}-status');
              if(statusEl){ statusEl.textContent = 'Updating…'; statusEl.classList.remove('hidden'); }
              fetch('/api/tiers/recalculate', {method:'POST', credentials:'include'})
                .then(function(r){ return r.json(); })
                .then(function(d){
                  if(statusEl){
                    if(d.success){
                      var changed = d.results && d.results.some(function(r){ return r.changed; });
                      statusEl.textContent = changed ? '✓ Tier updated!' : '✓ Up to date';
                      statusEl.classList.remove('hidden');
                    } else {
                      statusEl.textContent = d.error || 'Try again later';
                    }
                  }
                  setTimeout(function(){ location.reload(); }, 1200);
                })
                .catch(function(){
                  if(statusEl){ statusEl.textContent = 'Refresh failed'; }
                  btn.disabled = false;
                  if(icon){ icon.classList.remove('fa-spin'); }
                });
            })(this)"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white text-xs transition disabled:opacity-40 disabled:cursor-wait"
            title="Recalculate your tier based on latest activity">
            <i class="fas fa-sync-alt text-xs"></i>
            <span>Refresh</span>
          </button>
          <span id="${cardId}-status" class="hidden text-xs text-lime-400 font-medium text-right"></span>

          ${data.loyalty_credits > 0 ? `
          <div class="inline-flex items-center gap-1 px-2.5 py-1 bg-lime-500/10 border border-lime-500/20 rounded-xl">
            <i class="fas fa-coins text-lime-400 text-xs"></i>
            <span class="text-lime-300 text-xs font-bold">$${data.loyalty_credits.toFixed(2)}</span>
          </div>
          <p class="text-gray-600 text-xs">credits</p>` : ''}
        </div>
      </div>

      <!-- Tier stats row -->
      <div class="grid grid-cols-3 gap-2 mt-4">
        <div class="text-center">
          <p class="text-white font-bold text-sm">${data.metrics.r12_completed}</p>
          <p class="text-gray-500 text-xs">bookings (12mo)</p>
        </div>
        <div class="text-center">
          <p class="text-white font-bold text-sm">${data.metrics.r12_avg_rating > 0 ? data.metrics.r12_avg_rating.toFixed(1) + '★' : '—'}</p>
          <p class="text-gray-500 text-xs">avg rating</p>
        </div>
        ${revenueStatCell}
      </div>
    </div>

    <div class="p-5 pt-4">
      ${graceBanner}
      ${progressSection}

      <!-- Benefits -->
      <div class="border-t border-white/5 pt-4">
        <p class="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Active Benefits</p>
        <div class="space-y-0.5">
          ${benefitsHTML}
          ${noBenefits}
        </div>
      </div>

      ${tierSince ? `<p class="text-gray-600 text-xs mt-3 text-right">Member since ${tierSince}</p>` : ''}
    </div>
  </div>`
}
