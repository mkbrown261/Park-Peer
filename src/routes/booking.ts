import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const bookingPage = new Hono()

bookingPage.get('/:id', (c) => {
  const id = c.req.param('id')
  const content = `
  <div class="pt-16 min-h-screen">
    <div class="max-w-4xl mx-auto px-4 py-8">
      <!-- Breadcrumb -->
      <div class="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <a href="/" class="hover:text-white">Home</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <a href="/search" class="hover:text-white">Search</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <a href="/listing/${id}" class="hover:text-white">Listing</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <span class="text-gray-300">Checkout</span>
      </div>

      <!-- Steps -->
      <div class="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        ${['Select Time','Review & Pay','Confirmation'].map((step, i) => `
          <div class="flex items-center gap-2 flex-shrink-0">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full ${i === 1 ? 'gradient-bg text-white' : i < 1 ? 'bg-green-500 text-white' : 'bg-charcoal-200 text-gray-500'} flex items-center justify-center text-xs font-bold">
                ${i < 1 ? '<i class="fas fa-check text-xs"></i>' : i+1}
              </div>
              <span class="text-sm font-medium ${i === 1 ? 'text-white' : i < 1 ? 'text-green-400' : 'text-gray-500'}">${step}</span>
            </div>
            ${i < 2 ? '<div class="w-12 h-px bg-white/10"></div>' : ''}
          </div>
        `).join('')}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-6">
        <!-- Main Checkout Form -->
        <div class="md:col-span-3 space-y-5">
          
          <!-- Time Selection -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-clock text-indigo-400"></i>Parking Window
            </h2>
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div class="bg-charcoal-200 border border-white/10 rounded-xl p-4">
                <label class="text-xs text-gray-500 uppercase tracking-wider block mb-2">Arrive</label>
                <input type="datetime-local" id="booking-arrive" class="bg-transparent text-white text-sm w-full focus:outline-none"/>
              </div>
              <div class="bg-charcoal-200 border border-white/10 rounded-xl p-4">
                <label class="text-xs text-gray-500 uppercase tracking-wider block mb-2">Depart</label>
                <input type="datetime-local" id="booking-depart" class="bg-transparent text-white text-sm w-full focus:outline-none"/>
              </div>
            </div>
            <!-- Duration display -->
            <div class="flex items-center gap-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
              <i class="fas fa-info-circle text-indigo-400"></i>
              <span class="text-indigo-300 text-sm" id="duration-display">Duration: 4 hours</span>
            </div>
          </div>

          <!-- Vehicle Information -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-car text-indigo-400"></i>Your Vehicle
            </h2>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-xs text-gray-500 block mb-1.5">Make & Model</label>
                  <input type="text" placeholder="e.g. Toyota Camry" value="Honda Accord" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
                </div>
                <div>
                  <label class="text-xs text-gray-500 block mb-1.5">License Plate</label>
                  <input type="text" placeholder="e.g. ABC 1234" value="IL X47-293" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
                </div>
              </div>
              <div>
                <label class="text-xs text-gray-500 block mb-1.5">Vehicle Size</label>
                <div class="grid grid-cols-3 gap-2">
                  ${[{s:'Compact',e:'🚗'},{s:'Sedan/SUV',e:'🚙'},{s:'Truck/Van',e:'🛻'}].map((v,i) => `
                    <button onclick="selectVehicle(this)" class="vehicle-btn p-3 rounded-xl border text-center transition-all ${i===1 ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-charcoal-200 hover:border-indigo-500/50'}">
                      <span class="text-xl block">${v.e}</span>
                      <span class="text-xs text-gray-300 mt-1">${v.s}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <!-- Contact Info -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-user text-indigo-400"></i>Your Info
            </h2>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-500 block mb-1.5">First Name</label>
                <input type="text" value="Alex" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
              </div>
              <div>
                <label class="text-xs text-gray-500 block mb-1.5">Last Name</label>
                <input type="text" value="Martinez" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
              </div>
              <div class="col-span-2">
                <label class="text-xs text-gray-500 block mb-1.5">Phone (for QR code delivery)</label>
                <input type="tel" placeholder="+1 (555) 000-0000" value="+1 (312) 555-0192" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
              </div>
            </div>
          </div>

          <!-- Payment -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
            <h2 class="font-bold text-white text-lg mb-4 flex items-center gap-2">
              <i class="fas fa-credit-card text-indigo-400"></i>Payment
            </h2>
            
            <!-- Saved Cards -->
            <div class="space-y-2 mb-4">
              <label class="flex items-center gap-3 p-3 bg-charcoal-200 border border-indigo-500/40 rounded-xl cursor-pointer">
                <input type="radio" name="payment" checked class="accent-indigo-500"/>
                <div class="w-9 h-6 bg-gradient-to-r from-blue-600 to-blue-800 rounded-md flex items-center justify-center">
                  <span class="text-white text-xs font-black">VISA</span>
                </div>
                <span class="text-white text-sm flex-1">•••• •••• •••• 4242</span>
                <span class="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">Default</span>
              </label>
              <label class="flex items-center gap-3 p-3 bg-charcoal-200 border border-white/5 rounded-xl cursor-pointer hover:border-white/20">
                <input type="radio" name="payment" class="accent-indigo-500"/>
                <div class="w-9 h-6 bg-gradient-to-r from-orange-500 to-red-600 rounded-md flex items-center justify-center">
                  <span class="text-white text-xs font-black">MC</span>
                </div>
                <span class="text-white text-sm flex-1">•••• •••• •••• 8541</span>
              </label>
            </div>

            <!-- Alternative payments -->
            <div class="flex gap-2 mb-4">
              <button class="flex-1 flex items-center justify-center gap-2 p-3 bg-charcoal-200 border border-white/5 rounded-xl hover:border-white/20 transition-colors">
                <i class="fab fa-apple text-white text-lg"></i>
                <span class="text-white text-sm font-medium">Apple Pay</span>
              </button>
              <button class="flex-1 flex items-center justify-center gap-2 p-3 bg-charcoal-200 border border-white/5 rounded-xl hover:border-white/20 transition-colors">
                <i class="fab fa-google text-white text-lg"></i>
                <span class="text-white text-sm font-medium">Google Pay</span>
              </button>
            </div>

            <!-- Add new card -->
            <button onclick="toggleNewCard()" class="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-white/20 rounded-xl text-gray-400 hover:text-white hover:border-white/40 transition-colors text-sm">
              <i class="fas fa-plus"></i> Add New Card
            </button>
            <div id="new-card-form" class="hidden mt-3 space-y-2">
              <input type="text" placeholder="Card number" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
              <div class="grid grid-cols-2 gap-2">
                <input type="text" placeholder="MM/YY" class="bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
                <input type="text" placeholder="CVV" class="bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
              </div>
            </div>
          </div>

          <!-- Notes to Host -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
            <h2 class="font-bold text-white text-lg mb-3 flex items-center gap-2">
              <i class="fas fa-message text-indigo-400"></i>Message to Host (Optional)
            </h2>
            <textarea placeholder="Let the host know anything helpful, e.g. 'I'll be arriving in a blue Honda'" rows="3" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"></textarea>
          </div>

          <!-- No Bailment Disclaimer (required before payment) -->
          <div class="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
            <p class="text-xs text-yellow-300/80 leading-relaxed">
              <i class="fas fa-triangle-exclamation mr-1"></i>
              <strong>No Bailment:</strong> ParkPeer and the Host do not take custody of your vehicle. You park at your own risk. Neither ParkPeer nor the Host is liable for theft, damage, or towing.
              <a href="/legal/no-bailment" target="_blank" class="text-yellow-400 hover:underline ml-1">Learn more</a>
            </p>
          </div>

          <!-- Terms -->
          <label class="flex items-start gap-3 cursor-pointer group">
            <input type="checkbox" id="terms-check" class="mt-1 accent-indigo-500 w-4 h-4 flex-shrink-0"/>
            <p class="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
              I agree to ParkPeer's <a href="/legal/tos" class="text-indigo-400 hover:underline">Terms of Service</a>, <a href="/legal/privacy" class="text-indigo-400 hover:underline">Privacy Policy</a>, understand the <a href="/legal/tos#cancellation" class="text-indigo-400 hover:underline">Cancellation Policy</a>, and acknowledge the No Bailment disclaimer above.
            </p>
          </label>
        </div>

        <!-- Order Summary Sidebar -->
        <div class="md:col-span-2">
          <div class="sticky top-20 space-y-4">
            <!-- Listing Summary -->
            <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-5">
              <div class="flex gap-3 mb-4 pb-4 border-b border-white/5">
                <div class="w-16 h-16 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center flex-shrink-0">
                  <i class="fas fa-warehouse text-white/20 text-2xl"></i>
                </div>
                <div>
                  <p class="font-bold text-white text-sm leading-tight">Secure Covered Garage</p>
                  <p class="text-gray-500 text-xs mt-1 flex items-center gap-1">
                    <i class="fas fa-map-pin text-indigo-400"></i>120 S Michigan Ave
                  </p>
                  <div class="flex items-center gap-1 mt-1">
                    <i class="fas fa-star text-amber-400 text-xs"></i>
                    <span class="text-white text-xs">4.9</span>
                    <span class="text-gray-500 text-xs">(142)</span>
                  </div>
                </div>
              </div>

              <!-- Price Breakdown -->
              <div class="space-y-2.5 text-sm">
                <div class="flex justify-between text-gray-300">
                  <span>$12/hr × 4 hours</span>
                  <span>$48.00</span>
                </div>
                <div class="flex justify-between text-gray-300">
                  <span class="flex items-center gap-1">
                    Service fee
                    <i class="fas fa-circle-info text-gray-500 text-xs cursor-help" title="Platform fee covers payment processing, insurance, and 24/7 support"></i>
                  </span>
                  <span>$7.20</span>
                </div>
                <div class="flex justify-between text-gray-300">
                  <span>Taxes</span>
                  <span>$2.88</span>
                </div>
                <div class="border-t border-white/10 pt-2.5 flex justify-between font-bold text-white text-base">
                  <span>Total</span>
                  <span>$58.08</span>
                </div>
              </div>

              <!-- Cancellation Policy -->
              <div class="mt-4 p-3 bg-charcoal-200 rounded-xl flex gap-2.5">
                <i class="fas fa-calendar-xmark text-green-400 mt-0.5 flex-shrink-0"></i>
                <div>
                  <p class="text-white text-xs font-semibold">Free Cancellation</p>
                  <p class="text-gray-500 text-xs mt-0.5">Cancel before arrival for a full refund</p>
                </div>
              </div>
            </div>

            <!-- CTA Button -->
            <button onclick="confirmBooking()" class="btn-primary w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-white text-lg" id="confirm-btn">
              <i class="fas fa-lock"></i>
              Confirm & Pay $58.08
            </button>
            <p class="text-center text-gray-500 text-xs">
              <i class="fas fa-shield-halved text-green-400 mr-1"></i>
              Secured by Stripe · 256-bit SSL
            </p>

            <!-- What Happens Next -->
            <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-4">
              <h4 class="text-white font-semibold text-sm mb-3">What happens next?</h4>
              <div class="space-y-2.5">
                ${[
                  { icon: 'fa-envelope', text: 'Instant confirmation email', time: 'Now' },
                  { icon: 'fa-qrcode', text: 'QR check-in code delivered', time: '1 min' },
                  { icon: 'fa-map-location', text: 'Directions & access code sent', time: '1 min' },
                  { icon: 'fa-message', text: 'Host notified automatically', time: '1 min' },
                ].map(step => `
                  <div class="flex items-center gap-3">
                    <div class="w-7 h-7 bg-indigo-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <i class="fas ${step.icon} text-indigo-400 text-xs"></i>
                    </div>
                    <span class="text-gray-400 text-xs flex-1">${step.text}</span>
                    <span class="text-gray-600 text-xs">${step.time}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Success Modal -->
  <div id="success-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-sm border border-white/10 p-8 text-center">
      <div class="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-check text-green-400 text-3xl"></i>
      </div>
      <h2 class="text-2xl font-black text-white mb-2">Booking Confirmed!</h2>
      <p class="text-gray-400 mb-6">Your QR code and directions have been sent to your phone.</p>
      
      <!-- QR Code Placeholder -->
      <div class="w-40 h-40 mx-auto bg-white rounded-2xl flex items-center justify-center mb-6">
        <div class="w-32 h-32 grid grid-cols-4 gap-1 p-2">
          ${Array(16).fill(0).map(() => `<div class="rounded-sm ${Math.random() > 0.4 ? 'bg-black' : 'bg-white'}"></div>`).join('')}
        </div>
      </div>
      
      <p class="text-white font-bold text-lg mb-1">Booking #PP-2026-8741</p>
      <p class="text-gray-400 text-sm mb-6">Today · 10:00 AM – 2:00 PM</p>
      
      <div class="flex gap-3">
        <button onclick="window.location.href='/dashboard'" class="flex-1 py-3 btn-primary text-white rounded-xl font-semibold text-sm">
          View Booking
        </button>
        <button onclick="document.getElementById('success-modal').classList.add('hidden')" class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white">
          Close
        </button>
      </div>
    </div>
  </div>

  <script>
    const now = new Date();
    const later = new Date(now.getTime() + 4 * 3600000);
    const fmt = d => d.toISOString().slice(0,16);
    document.getElementById('booking-arrive').value = fmt(now);
    document.getElementById('booking-depart').value = fmt(later);
    document.getElementById('booking-arrive').min = fmt(now);

    function updateDuration() {
      const a = new Date(document.getElementById('booking-arrive').value);
      const d = new Date(document.getElementById('booking-depart').value);
      if (!a || !d || d <= a) return;
      const h = Math.round((d-a)/3600000);
      document.getElementById('duration-display').textContent = 'Duration: ' + h + ' hour' + (h > 1 ? 's' : '');
    }
    document.getElementById('booking-arrive').addEventListener('change', updateDuration);
    document.getElementById('booking-depart').addEventListener('change', updateDuration);

    function selectVehicle(btn) {
      document.querySelectorAll('.vehicle-btn').forEach(b => {
        b.className = 'vehicle-btn p-3 rounded-xl border text-center transition-all border-white/5 bg-charcoal-200 hover:border-indigo-500/50';
      });
      btn.className = 'vehicle-btn p-3 rounded-xl border text-center transition-all border-indigo-500 bg-indigo-500/10';
    }

    function toggleNewCard() {
      document.getElementById('new-card-form').classList.toggle('hidden');
    }

    function confirmBooking() {
      const terms = document.getElementById('terms-check');
      if (!terms.checked) {
        terms.closest('label').classList.add('border', 'border-red-500/50', 'rounded-xl', 'p-2');
        alert('Please accept the terms to continue');
        return;
      }
      const btn = document.getElementById('confirm-btn');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
      btn.disabled = true;
      setTimeout(() => {
        document.getElementById('success-modal').classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-lock"></i> Confirm & Pay $58.08';
        btn.disabled = false;
      }, 2000);
    }
  </script>
  `
  return c.html(Layout('Checkout', content))
})
