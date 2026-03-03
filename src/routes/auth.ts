import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const authPages = new Hono()

authPages.get('/login', (c) => {
  const content = `
  <div class="pt-16 min-h-screen flex items-center justify-center px-4 py-12">
    <div class="absolute inset-0 map-bg opacity-20"></div>
    <div class="absolute top-20 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
    <div class="absolute bottom-20 right-1/4 w-80 h-80 bg-lime-500/5 rounded-full blur-3xl pointer-events-none"></div>
    
    <div class="relative w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <a href="/" class="inline-flex items-center gap-2 group">
          <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center glow-indigo">
            <i class="fas fa-parking text-white text-xl"></i>
          </div>
          <span class="text-3xl font-black">Park<span class="gradient-text">Peer</span></span>
        </a>
        <p class="text-gray-400 mt-2 text-sm">Welcome back. The curb awaits.</p>
      </div>

      <!-- Card -->
      <div class="glass rounded-3xl p-8 border border-white/10">
        <h2 class="text-2xl font-black text-white text-center mb-6">Sign In</h2>
        
        <!-- Social Login -->
        <div class="grid grid-cols-2 gap-3 mb-6">
          <button class="flex items-center justify-center gap-2 p-3 bg-charcoal-100 border border-white/10 rounded-xl hover:border-white/30 transition-all text-white text-sm font-medium group">
            <div class="w-5 h-5 bg-white rounded-sm flex items-center justify-center">
              <i class="fab fa-google text-gray-800 text-xs"></i>
            </div>
            Google
          </button>
          <button class="flex items-center justify-center gap-2 p-3 bg-charcoal-100 border border-white/10 rounded-xl hover:border-white/30 transition-all text-white text-sm font-medium">
            <i class="fab fa-apple text-white text-lg"></i>
            Apple
          </button>
        </div>

        <div class="relative flex items-center gap-3 mb-6">
          <div class="flex-1 h-px bg-white/10"></div>
          <span class="text-gray-500 text-xs uppercase tracking-wider">or</span>
          <div class="flex-1 h-px bg-white/10"></div>
        </div>
        
        <!-- Form -->
        <form onsubmit="handleLogin(event)" class="space-y-4">
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-1.5">Email Address</label>
            <div class="relative">
              <i class="fas fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
              <input type="email" id="login-email" placeholder="you@example.com" required
                class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-sm text-gray-400 font-medium">Password</label>
              <a href="#" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Forgot password?</a>
            </div>
            <div class="relative">
              <i class="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
              <input type="password" id="login-password" placeholder="••••••••" required
                class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
              <button type="button" onclick="togglePass('login-password', this)" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                <i class="fas fa-eye text-sm"></i>
              </button>
            </div>
          </div>
          
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" class="accent-indigo-500 w-4 h-4"/>
            <span class="text-sm text-gray-400">Keep me signed in for 30 days</span>
          </label>

          <div id="login-error" class="hidden p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
            <i class="fas fa-exclamation-circle text-red-400 text-sm"></i>
            <p class="text-red-400 text-sm">Invalid email or password. Please try again.</p>
          </div>

          <button type="submit" id="login-btn" class="btn-primary w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white text-base">
            <i class="fas fa-sign-in-alt"></i>
            Sign In
          </button>
        </form>

        <p class="text-center text-gray-500 text-sm mt-6">
          Don't have an account? 
          <a href="/auth/signup" class="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">Sign Up Free</a>
        </p>
      </div>

      <!-- Trust badges -->
      <div class="flex items-center justify-center gap-6 mt-6 text-xs text-gray-500">
        <div class="flex items-center gap-1.5">
          <i class="fas fa-shield-halved text-green-400"></i> Secure Login
        </div>
        <div class="flex items-center gap-1.5">
          <i class="fas fa-lock text-green-400"></i> 256-bit SSL
        </div>
        <div class="flex items-center gap-1.5">
          <i class="fas fa-eye-slash text-green-400"></i> Never Shared
        </div>
      </div>
    </div>
  </div>

  <script>
    function togglePass(id, btn) {
      const inp = document.getElementById(id);
      const icon = btn.querySelector('i');
      if (inp.type === 'password') {
        inp.type = 'text';
        icon.className = 'fas fa-eye-slash text-sm';
      } else {
        inp.type = 'password';
        icon.className = 'fas fa-eye text-sm';
      }
    }

    function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in...';
      btn.disabled = true;
      setTimeout(() => {
        const email = document.getElementById('login-email').value;
        if (email && email.includes('@')) {
          window.location.href = '/dashboard';
        } else {
          document.getElementById('login-error').classList.remove('hidden');
          btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
          btn.disabled = false;
        }
      }, 1500);
    }
  </script>
  `
  return c.html(Layout('Sign In', content))
})

authPages.get('/signup', (c) => {
  const content = `
  <div class="pt-16 min-h-screen flex items-center justify-center px-4 py-12">
    <div class="absolute inset-0 map-bg opacity-20"></div>
    <div class="absolute top-20 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

    <div class="relative w-full max-w-lg">
      <!-- Logo -->
      <div class="text-center mb-8">
        <a href="/" class="inline-flex items-center gap-2">
          <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center glow-indigo">
            <i class="fas fa-parking text-white text-xl"></i>
          </div>
          <span class="text-3xl font-black">Park<span class="gradient-text">Peer</span></span>
        </a>
        <p class="text-gray-400 mt-2 text-sm">Join 89,000+ drivers and hosts.</p>
      </div>

      <div class="glass rounded-3xl p-8 border border-white/10">
        <h2 class="text-2xl font-black text-white text-center mb-2">Create Account</h2>
        <p class="text-gray-400 text-sm text-center mb-6">Free to join. No monthly fees.</p>

        <!-- Role Selection -->
        <div class="grid grid-cols-2 gap-3 mb-6">
          <button onclick="selectRole('driver', this)" id="role-driver" class="role-btn p-4 rounded-2xl border border-indigo-500 bg-indigo-500/10 text-center transition-all">
            <i class="fas fa-car text-indigo-400 text-2xl mb-2 block"></i>
            <p class="font-bold text-white text-sm">Driver</p>
            <p class="text-gray-500 text-xs mt-0.5">Find & book parking</p>
          </button>
          <button onclick="selectRole('host', this)" id="role-host" class="role-btn p-4 rounded-2xl border border-white/5 bg-charcoal-100 text-center transition-all hover:border-lime-500/50">
            <i class="fas fa-home text-gray-400 text-2xl mb-2 block"></i>
            <p class="font-bold text-white text-sm">Host</p>
            <p class="text-gray-500 text-xs mt-0.5">List & earn</p>
          </button>
        </div>
        <p class="text-xs text-gray-500 text-center mb-6 -mt-2">You can do both — choose your primary role</p>

        <!-- Social Signup -->
        <div class="grid grid-cols-2 gap-3 mb-5">
          <button class="flex items-center justify-center gap-2 p-3 bg-charcoal-100 border border-white/10 rounded-xl hover:border-white/30 transition-all text-white text-sm font-medium">
            <div class="w-5 h-5 bg-white rounded-sm flex items-center justify-center">
              <i class="fab fa-google text-gray-800 text-xs"></i>
            </div>
            Google
          </button>
          <button class="flex items-center justify-center gap-2 p-3 bg-charcoal-100 border border-white/10 rounded-xl hover:border-white/30 transition-all text-white text-sm font-medium">
            <i class="fab fa-apple text-white text-lg"></i>
            Apple
          </button>
        </div>

        <div class="relative flex items-center gap-3 mb-5">
          <div class="flex-1 h-px bg-white/10"></div>
          <span class="text-gray-500 text-xs uppercase tracking-wider">or</span>
          <div class="flex-1 h-px bg-white/10"></div>
        </div>

        <!-- Form -->
        <form onsubmit="handleSignup(event)" class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-400 font-medium block mb-1.5">First Name</label>
              <input type="text" placeholder="Alex" required class="w-full bg-charcoal-100 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
            </div>
            <div>
              <label class="text-xs text-gray-400 font-medium block mb-1.5">Last Name</label>
              <input type="text" placeholder="Martinez" required class="w-full bg-charcoal-100 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-400 font-medium block mb-1.5">Email Address</label>
            <div class="relative">
              <i class="fas fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
              <input type="email" placeholder="you@example.com" required class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-400 font-medium block mb-1.5">Phone Number</label>
            <div class="relative">
              <i class="fas fa-phone absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
              <input type="tel" placeholder="+1 (555) 000-0000" class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-400 font-medium flex items-center justify-between mb-1.5">
              Password
              <span id="pass-strength" class="text-xs"></span>
            </label>
            <div class="relative">
              <i class="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
              <input type="password" id="signup-password" placeholder="Min 8 characters" required oninput="checkStrength(this)"
                class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
              <button type="button" onclick="togglePass('signup-password', this)" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                <i class="fas fa-eye text-sm"></i>
              </button>
            </div>
            <!-- Strength bar -->
            <div class="flex gap-1 mt-2">
              ${Array(4).fill(0).map((_, i) => `<div class="strength-bar flex-1 h-1 bg-charcoal-300 rounded-full transition-all" data-index="${i}"></div>`).join('')}
            </div>
          </div>

          <!-- Terms -->
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" required class="mt-1 accent-indigo-500 w-4 h-4 flex-shrink-0"/>
            <p class="text-xs text-gray-400">
              I agree to ParkPeer's <a href="#" class="text-indigo-400 hover:underline">Terms of Service</a> and <a href="#" class="text-indigo-400 hover:underline">Privacy Policy</a>. I consent to SMS and email notifications.
            </p>
          </label>

          <button type="submit" id="signup-btn" class="btn-primary w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white text-base">
            <i class="fas fa-rocket"></i>
            Create Free Account
          </button>
        </form>

        <p class="text-center text-gray-500 text-sm mt-5">
          Already have an account? 
          <a href="/auth/login" class="text-indigo-400 hover:text-indigo-300 font-semibold">Sign In</a>
        </p>
      </div>
    </div>
  </div>

  <script>
    function togglePass(id, btn) {
      const inp = document.getElementById(id);
      const icon = btn.querySelector('i');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      icon.className = inp.type === 'text' ? 'fas fa-eye-slash text-sm' : 'fas fa-eye text-sm';
    }

    function selectRole(role, btn) {
      document.querySelectorAll('.role-btn').forEach(b => {
        b.className = 'role-btn p-4 rounded-2xl border border-white/5 bg-charcoal-100 text-center transition-all hover:border-lime-500/50';
        b.querySelector('i').className = b.querySelector('i').className.replace('text-indigo-400', 'text-gray-400').replace('text-lime-500', 'text-gray-400');
      });
      if (role === 'driver') {
        btn.className = 'role-btn p-4 rounded-2xl border border-indigo-500 bg-indigo-500/10 text-center transition-all';
        btn.querySelector('i').className = btn.querySelector('i').className.replace('text-gray-400', 'text-indigo-400');
      } else {
        btn.className = 'role-btn p-4 rounded-2xl border border-lime-500 bg-lime-500/10 text-center transition-all';
        btn.querySelector('i').className = btn.querySelector('i').className.replace('text-gray-400', 'text-lime-500');
      }
    }

    function checkStrength(inp) {
      const val = inp.value;
      let score = 0;
      if (val.length >= 8) score++;
      if (/[A-Z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^a-zA-Z0-9]/.test(val)) score++;
      
      const bars = document.querySelectorAll('.strength-bar');
      const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];
      const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
      
      bars.forEach((bar, i) => {
        bar.className = 'strength-bar flex-1 h-1 rounded-full transition-all ' + (i < score ? colors[score-1] : 'bg-charcoal-300');
      });
      
      const el = document.getElementById('pass-strength');
      if (val.length > 0) {
        el.textContent = labels[score];
        el.className = 'text-xs ' + ['', 'text-red-400', 'text-orange-400', 'text-yellow-400', 'text-green-400'][score];
      } else {
        el.textContent = '';
      }
    }

    function handleSignup(e) {
      e.preventDefault();
      const btn = document.getElementById('signup-btn');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating account...';
      btn.disabled = true;
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 2000);
    }
  </script>
  `
  return c.html(Layout('Sign Up', content))
})
