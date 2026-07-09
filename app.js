/* =========================================================
   app.js — Core shared logic (Firebase Auth + Firestore)
   NIAT Schools Attendance System
========================================================= */
'use strict';

// =====================================================
// FIRESTORE — USERS COLLECTION
// =====================================================
const UsersDB = {

  async getAll() {
    const snap = await db.collection('users').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getTeachers() {
    const snap = await db.collection('users')
      .where('role', '==', 'teacher').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getById(id) {
    const doc = await db.collection('users').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  async update(id, data) {
    await db.collection('users').doc(id).update(data);
  },

  async delete(id) {
    // Delete user doc from Firestore (Auth account stays but access denied)
    await db.collection('users').doc(id).delete();
    // Also delete their attendance records
    const attSnap = await db.collection('attendance')
      .where('userId', '==', id).get();
    const batch = db.batch();
    attSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  },

  async add(data) {
    // Called after Firebase Auth createUser — write profile to Firestore
    const ref = db.collection('users').doc(data.uid);
    const profile = {
      name:      data.name,
      rollNo:    data.rollNo    || '',
      className: data.className || '',
      mobile:    data.mobile    || '',
      email:     data.email.toLowerCase(),
      role:      data.role,
      createdAt: new Date().toISOString()
    };
    await ref.set(profile);
    return { id: data.uid, ...profile };
  }
};

// =====================================================
// FIRESTORE — ATTENDANCE COLLECTION
// =====================================================
const AttDB = {

  todayKey: () => new Date().toISOString().slice(0, 10),

  async getToday() {
    const snap = await db.collection('attendance')
      .where('date', '==', this.todayKey()).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getAll() {
    const snap = await db.collection('attendance').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getForUser(userId) {
    const snap = await db.collection('attendance')
      .where('userId', '==', userId).get();
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort descending by timestamp in JS (avoids composite index requirement)
    return records.sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp));
  },

  getCurrentSession() {
    return new Date().getHours() < 13 ? 'morning' : 'afternoon';
  },

  async hasMarkedSession(userId) {
    const todayRec = await this.getToday();
    const sessionType = this.getCurrentSession();
    return todayRec.some(r => r.userId === userId && r.session === sessionType);
  },

  async getSessionRecord(userId) {
    const todayRec = await this.getToday();
    const sessionType = this.getCurrentSession();
    return todayRec.find(r => r.userId === userId && r.session === sessionType) || null;
  },

  async mark(userId, userName, userRoll, userClass, lat, lng, distanceM) {
    const record = {
      userId, userName, userRoll, userClass,
      date:      this.todayKey(),
      time:      new Date().toLocaleTimeString('en-IN'),
      timestamp: new Date().toISOString(),
      lat, lng,
      distanceM: Math.round(distanceM),
      status:    'present'
    };
    const ref = await db.collection('attendance').add(record);
    return { id: ref.id, ...record };
  },

  async getStats(userId) {
    const allAtt  = await this.getAll();
    const allDays = [...new Set(allAtt.map(r => r.date))];
    const userRec = allAtt.filter(r => r.userId === userId);
    
    // Account for 2 sessions (morning/afternoon) per day
    const present = userRec.length;
    const maxSessions = allDays.length * 2;
    const absent  = Math.max(0, maxSessions - present);
    const pct     = maxSessions > 0
      ? Math.round((present / maxSessions) * 100) : 0;
      
    return { present: present * 0.5, absent: absent * 0.5, days: allDays.length, pct };
  }
};

// =====================================================
// FIRESTORE — SETTINGS
// =====================================================
const Settings = {
  async get() {
    let doc;
    try {
      doc = await db.collection('settings').doc('school').get({ source: 'cache' });
      if (!doc.exists) throw new Error('cache miss');
    } catch (e) {
      doc = await db.collection('settings').doc('school').get({ source: 'server' });
    }
    return doc.exists
      ? doc.data()
      : { radius: 100, schoolName: 'NIAT Schools', schoolLat: null, schoolLng: null };
  },
  async set(data) {
    await db.collection('settings').doc('school')
      .set(data, { merge: true });
  }
};

// =====================================================
// AUTH HELPERS
// =====================================================
const Auth = {

  // Returns Promise<userProfile> or redirects to login
  requireAuth(allowedRoles) {
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
        unsubscribe();

        if (!firebaseUser) {
          location.href = 'login.html';
          return;
        }

        try {
          let doc;
          try {
            // Instant navigation: try local cache first
            doc = await db.collection('users').doc(firebaseUser.uid).get({ source: 'cache' });
            if (!doc.exists) throw new Error('cache miss');
          } catch (e) {
            // Fallback to server if not cached
            doc = await db.collection('users').doc(firebaseUser.uid).get({ source: 'server' });
          }

          // Auto-create profile if missing (safety net)
          if (!doc.exists) {
            const nameParts = (firebaseUser.displayName || firebaseUser.email.split('@')[0]);
            const autoProfile = {
              name:      nameParts,
              email:     firebaseUser.email,
              role:      'teacher',
              rollNo:    '',
              className: '',
              mobile:    '',
              createdAt: new Date().toISOString()
            };
            await db.collection('users').doc(firebaseUser.uid).set(autoProfile);
            doc = await db.collection('users').doc(firebaseUser.uid).get();
          }

          const userData = { id: firebaseUser.uid, ...doc.data() };
          
          // STRICT OVERRIDE FOR HARDCODED ADMIN
          if (firebaseUser.email && firebaseUser.email.toLowerCase() === 'admin@niat.com') {
            userData.role = 'admin';
          }

          if (allowedRoles && !allowedRoles.includes(userData.role)) {
            // Role not allowed on this page — go to dashboard
            location.href = 'dashboard.html';
            return;
          }

          resolve(userData);

        } catch (err) {
          console.error('requireAuth Firestore error:', err.code, err.message);
          // Don't logout on network errors — just resolve with basic info
          if (err.code === 'unavailable' || err.code === 'network-request-failed') {
            resolve({
              id:    firebaseUser.uid,
              email: firebaseUser.email,
              name:  firebaseUser.displayName || firebaseUser.email,
              role:  'student'
            });
          } else {
            location.href = 'login.html';
          }
        }
      });
    });
  },

  async logout() {
    await auth.signOut();
    location.href = 'login.html';
  }
};

// =====================================================
// GPS UTILITIES
// =====================================================
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2
    + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =====================================================
// SIDEBAR (shared across all app pages)
// =====================================================
function initSidebar(session) {
  const ham = document.getElementById('ham-app');
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sb-overlay');

  ham?.addEventListener('click', () => {
    sb?.classList.toggle('open');
    ov?.classList.toggle('visible');
  });
  ov?.addEventListener('click', () => {
    sb?.classList.remove('open');
    ov?.classList.remove('visible');
  });

  // Populate user info
  if (session) {
    const initials = session.name
      .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const el = id => document.getElementById(id);
    if (el('user-avatar-sb')) el('user-avatar-sb').textContent = initials;
    if (el('user-name-sb'))   el('user-name-sb').textContent   = session.name;
    if (el('user-role-sb'))   el('user-role-sb').textContent   = session.role;
  }

  // Logout
  document.getElementById('logout-btn')
    ?.addEventListener('click', Auth.logout);

  // Settings Link Navigation
  const settingsLink = document.getElementById('sb-settings');
  if (settingsLink) {
    if (session && session.role === 'admin') {
      settingsLink.style.display = 'flex';
      settingsLink.href = 'admin.html';
      const newSettingsLink = settingsLink.cloneNode(true);
      settingsLink.parentNode.replaceChild(newSettingsLink, settingsLink);
    } else {
      settingsLink.style.display = 'none';
    }
  }

  // Timetable Link — Admin only (Timetable Manager)
  const ttLink = document.getElementById('sb-timetable');
  if (ttLink) {
    if (session && session.role === 'admin') {
      ttLink.style.display = 'flex';
    } else {
      ttLink.style.display = 'none';
    }
  }

  // My Timetable Link
  const myTtLink = document.getElementById('sb-my-tt');
  if (myTtLink) {
    if (session && session.role === 'admin') {
      myTtLink.style.display = 'none';
    } else {
      myTtLink.style.display = 'flex';
      myTtLink.innerHTML = '<span class="sb-icon">📅</span> My Timetable';
      myTtLink.href      = 'my-timetable.html';
    }
  }
}

// =====================================================
// TOAST NOTIFICATION
// =====================================================
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:99998;
    padding:12px 24px;border-radius:12px;font-size:0.9rem;font-weight:600;
    background:${type==='success'?'rgba(16,185,129,0.15)':type==='error'?'rgba(239,68,68,0.15)':'rgba(124,58,237,0.15)'};
    border:1px solid ${type==='success'?'rgba(16,185,129,0.4)':type==='error'?'rgba(239,68,68,0.4)':'rgba(124,58,237,0.4)'};
    color:${type==='success'?'#10b981':type==='error'?'#ef4444':'#7c3aed'};
    backdrop-filter:blur(10px);animation:fadeUp 0.3s ease;
    font-family:'Outfit',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.3);
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// =====================================================
// DATE HELPERS
// =====================================================
function todayStr() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}
function formatMobile(num) {
  let cleaned = num.replace(/\D/g, ''); // Remove all non-digits
  if (cleaned.startsWith('91') && cleaned.length > 10) {
    cleaned = cleaned.substring(2);
  }
  return '+91' + cleaned;
}
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

// =====================================================
// HIDE PAGE LOADING OVERLAY
// =====================================================
function hidePageLoader() {
  const el = document.getElementById('page-loader');
  if (el) {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }
}

// =====================================================
// LOGIN / REGISTER PAGE LOGIC
// =====================================================
if (document.getElementById('login-form')) {
  let selectedLoginRole = 'teacher';
  let selectedRegRole   = 'teacher';
  let isSubmittingAuth  = false;

  // Tab switching
  const tabLogin    = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  tabLogin?.addEventListener('click',    () => switchToLogin());
  tabRegister?.addEventListener('click', () => switchToRegister());
  document.getElementById('to-register')?.addEventListener('click', () => switchToRegister());
  document.getElementById('to-login')?.addEventListener('click',    () => switchToLogin());
  document.getElementById('to-admin-login')?.addEventListener('click', () => switchToAdmin());
  document.getElementById('admin-to-login')?.addEventListener('click', () => switchToLogin());

  // Role pills code removed since there is only one role now

  // Password toggles
  setupPwToggle('login-pw',  'toggle-login-pw');
  setupPwToggle('reg-pw',    'toggle-reg-pw');
  setupPwToggle('admin-pw',  'toggle-admin-pw');

  // URL params — pre-select role / mode
  const params = new URLSearchParams(location.search);
  if (params.get('mode') === 'register') switchToRegister();
  const urlRole = params.get('role');
  if (urlRole) {
    document.querySelectorAll(`[data-role="${urlRole}"]`).forEach(b => {
      b.closest('.role-selector')
        ?.querySelectorAll('.role-pill').forEach(p => p.classList.remove('active'));
      b.classList.add('active');
    });
    selectedLoginRole = urlRole;
    selectedRegRole   = urlRole;
  }

  // ---- LOGIN SUBMIT ----
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    isSubmittingAuth = true;
    const idVal = document.getElementById('login-id').value.trim();
    const pw    = document.getElementById('login-pw').value;
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-submit');
    errEl.textContent = '';
    btn.textContent   = 'Logging in...';
    btn.disabled      = true;

    try {
      if (idVal.toLowerCase() === 'admin@niat.com' || idVal.toLowerCase() === 'jinkatulasiram@gmail.com') {
        errEl.textContent = '❌ Admin accounts must use the Admin Portal below.';
        btn.textContent   = 'Login →';
        btn.disabled      = false;
        isSubmittingAuth  = false;
        return;
      }
      
      // Normal Sign in
      const cred = await auth.signInWithEmailAndPassword(idVal, pw); // Ensure session
      const uid  = cred.user.uid;

      // Get or create Firestore profile
      let doc = await db.collection('users').doc(uid).get();
      if (!doc.exists) {
        // Auto-create profile — use selected role
        await db.collection('users').doc(uid).set({
          name:      idVal.split('@')[0],
          email:     idVal.toLowerCase(),
          role:      selectedLoginRole,
          rollNo:    '',
          className: '',
          mobile:    '',
          createdAt: new Date().toISOString()
        });
      }
      
      // 🔥 GUARANTEE ADMIN ROLE FOR YOUR EMAIL 🔥
      const lowerEmail = idVal.toLowerCase();
      if (lowerEmail === 'jinkatulasiram@gmail.com' || lowerEmail === 'admin@niat.com') {
        await db.collection('users').doc(uid).update({ role: 'admin' });
      }

      // ✅ Login success — check role for redirect
      btn.textContent = '✓ Logged In!';

      // Get user's profile to check role (use local cached doc from step above)
      let uData;
      if (doc.exists) {
        uData = doc.data();
        if (lowerEmail === 'jinkatulasiram@gmail.com' || lowerEmail === 'admin@niat.com') {
          uData.role = 'admin'; // Reflect the forced update above
        }
      } else {
        uData = { name: idVal.split('@')[0], role: lowerEmail === 'admin@niat.com' ? 'admin' : selectedLoginRole };
      }

      if (uData.role === 'admin' || lowerEmail === 'admin@niat.com') {
        // Admins bypass the quick action screen and go straight to Admin Panel
        setTimeout(() => { location.href = 'admin.html'; }, 200);
      } else {
        // Students/Teachers see the post-login quick action screen
        const screen  = document.getElementById('post-login-screen');
        const nameEl  = document.getElementById('pl-name');
        if (nameEl)  nameEl.textContent = uData.name + ' 👋';
        if (screen) {
          screen.style.display = 'flex';
        } else {
          // Fallback — just redirect
          setTimeout(() => { location.href = 'dashboard.html'; }, 400);
        }
      }

    } catch (err) {
      isSubmittingAuth = false;
      let msg = err.message;
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential')
        msg = 'No account found. Please Register first ↓';
      if (err.code === 'auth/wrong-password')
        msg = 'Wrong password. Try again.';
      if (err.code === 'auth/invalid-email')
        msg = 'Enter a valid email address.';
      if (err.code === 'auth/too-many-requests')
        msg = 'Too many attempts. Wait a minute and try again.';
      errEl.textContent = '❌ ' + msg;
      btn.textContent   = 'Login →';
      btn.disabled      = false;
    }
  });

  // ---- ADMIN LOGIN SUBMIT ----
  document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    isSubmittingAuth = true;
    const idVal = document.getElementById('admin-id').value.trim();
    const pw    = document.getElementById('admin-pw').value;
    const errEl = document.getElementById('admin-error');
    const btn   = document.getElementById('admin-submit');
    errEl.textContent = '';
    btn.textContent   = 'Authenticating...';
    btn.disabled      = true;

    try {
      if (idVal.toLowerCase() !== 'admin@niat.com' && idVal.toLowerCase() !== 'jinkatulasiram@gmail.com') {
        throw new Error('Access Denied. Not an authorized admin account.');
      }

      // 🔥 HARDCODED DEMO ADMIN LOGIC 🔥
      if (idVal.toLowerCase() === 'admin@niat.com' && pw === 'admin123') {
        try {
          await auth.signInWithEmailAndPassword(idVal, pw);
        } catch (error) {
          if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            await auth.createUserWithEmailAndPassword(idVal, pw);
          } else throw error;
        }
      } else {
        await auth.signInWithEmailAndPassword(idVal, pw);
      }
      
      const cred = await auth.signInWithEmailAndPassword(idVal, pw);
      const uid  = cred.user.uid;

      // Ensure Admin profile
      let doc = await db.collection('users').doc(uid).get();
      if (!doc.exists) {
        await db.collection('users').doc(uid).set({
          name:      idVal.split('@')[0],
          email:     idVal.toLowerCase(),
          role:      'admin',
          createdAt: new Date().toISOString()
        });
      } else {
        await db.collection('users').doc(uid).update({ role: 'admin' });
      }

      btn.textContent = '✓ Access Granted!';
      setTimeout(() => { location.href = 'admin.html'; }, 200);

    } catch (err) {
      isSubmittingAuth = false;
      errEl.textContent = '❌ ' + (err.message || 'Access Denied.');
      btn.textContent   = 'Access Portal →';
      btn.disabled      = false;
    }
  });

  // ---- REGISTER SUBMIT ----
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    isSubmittingAuth = true;
    const name   = document.getElementById('reg-name').value.trim();
    const roll   = document.getElementById('reg-roll').value.trim();
    const cls    = document.getElementById('reg-class').value.trim();
    let mobile   = document.getElementById('reg-mobile').value.trim();
    const email  = document.getElementById('reg-email').value.trim();
    
    if (mobile) mobile = formatMobile(mobile);
    const pw     = document.getElementById('reg-pw').value;
    const pw2    = document.getElementById('reg-pw2').value;
    const errEl  = document.getElementById('reg-error');
    const btn    = document.getElementById('reg-submit');
    errEl.textContent = '';

    if (!name || !email || !mobile) {
      errEl.textContent = '❌ Please fill all required fields.'; return;
    }
    if (pw.length < 6) {
      errEl.textContent = '❌ Password must be at least 6 characters.'; return;
    }
    if (pw !== pw2) {
      errEl.textContent = '❌ Passwords do not match.'; return;
    }

    btn.textContent = 'Creating account...';
    btn.disabled    = true;

    try {
      // Create Firebase Auth account
      const cred = await auth.createUserWithEmailAndPassword(email, pw);

      // Save profile to Firestore
      await UsersDB.add({
        uid: cred.user.uid, name, rollNo: roll,
        className: cls, mobile, email, role: selectedRegRole
      });

      // 1. Sign out the automatically logged in user
      await auth.signOut();

      // 2. Show success message
      btn.textContent = '✓ Account Created! Please Login';
      
      // 3. Pre-fill login email
      const loginIdEl = document.getElementById('login-id');
      if (loginIdEl) loginIdEl.value = email;

      // 4. Switch to login screen after a brief delay
      setTimeout(() => { 
        switchToLogin(); 
        btn.textContent = 'Register'; // Reset the button
        btn.disabled = false;
        document.getElementById('register-form').reset();
        isSubmittingAuth = false;
      }, 1500);

    } catch (err) {
      isSubmittingAuth = false;
      let msg = err.message;
      if (err.code === 'auth/email-already-in-use')
        msg = 'This email is already registered. Please login instead.';
      if (err.code === 'auth/invalid-email')
        msg = 'Invalid email address.';
      if (err.code === 'auth/weak-password')
        msg = 'Password is too weak. Use at least 6 characters.';
      errEl.textContent = '❌ ' + msg;
      btn.textContent   = 'Create Account →';
      btn.disabled      = false;
    }
  });

  // ---- OTP LOGIN LOGIC ----
  document.getElementById('to-otp')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchToOtp();
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible'
      });
    }
  });

  document.getElementById('to-login-from-otp')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchToLogin();
  });

  let confirmationResult = null;

  document.getElementById('btn-send-otp')?.addEventListener('click', async () => {
    let mobile = document.getElementById('otp-mobile').value.trim();
    if (mobile) mobile = formatMobile(mobile);
    const err1 = document.getElementById('otp-error-1');
    const btn = document.getElementById('btn-send-otp');
    err1.textContent = '';

    if (!mobile || mobile.length < 10) {
      err1.textContent = '❌ Enter a valid mobile number with country code (e.g. +91...)';
      return;
    }

    btn.textContent = 'Sending...';
    btn.disabled = true;

    try {
      confirmationResult = await auth.signInWithPhoneNumber(mobile, window.recaptchaVerifier);
      document.getElementById('otp-step-1').style.display = 'none';
      document.getElementById('otp-step-2').style.display = 'block';
      showToast('OTP sent via SMS!', 'success');
    } catch (error) {
      console.error(error);
      err1.textContent = '❌ ' + error.message;
      btn.textContent = 'Send OTP →';
      btn.disabled = false;
      if (window.recaptchaVerifier) window.recaptchaVerifier.render().then(w => window.recaptchaVerifier.reset(w));
    }
  });

  document.getElementById('btn-verify-otp')?.addEventListener('click', async () => {
    const code = document.getElementById('otp-code').value.trim();
    const err2 = document.getElementById('otp-error-2');
    const btn = document.getElementById('btn-verify-otp');
    err2.textContent = '';

    if (!code || code.length < 6) {
      err2.textContent = '❌ Enter the 6-digit code';
      return;
    }

    btn.textContent = 'Verifying...';
    btn.disabled = true;
    isSubmittingAuth = true;

    try {
      const result = await confirmationResult.confirm(code);
      const user = result.user;
      
      // ✅ Account Migration Logic: Find if they registered with Email previously
      let mobileEntered = document.getElementById('otp-mobile').value.trim();
      if (mobileEntered) mobileEntered = formatMobile(mobileEntered);
      const userSnap = await db.collection('users').where('mobile', '==', mobileEntered).get();

      if (!userSnap.empty) {
        const oldDoc = userSnap.docs[0];
        const oldUid = oldDoc.id;

        // If UIDs don't match, we need to migrate!
        if (oldUid !== user.uid) {
          const oldData = oldDoc.data();
          
          // 1. Copy profile to new UID
          await db.collection('users').doc(user.uid).set(oldData);
          
          // 2. Delete old profile
          await db.collection('users').doc(oldUid).delete();

          // 3. Migrate all attendance records
          const attSnap = await db.collection('attendance').where('userId', '==', oldUid).get();
          if (!attSnap.empty) {
            const batch = db.batch();
            attSnap.docs.forEach(doc => {
              batch.update(doc.ref, { userId: user.uid });
            });
            await batch.commit();
          }
          console.log("Account successfully migrated to Phone Auth UID!");
        }
      } else {
        // First time ever seeing this mobile number, create basic profile
        const doc = await db.collection('users').doc(user.uid).get();
        if (!doc.exists) {
          await db.collection('users').doc(user.uid).set({
            name: 'Teacher ' + mobileEntered.slice(-4),
            mobile: mobileEntered,
            role: 'teacher',
            email: '',
            createdAt: new Date().toISOString()
          });
        }
      }

      btn.textContent = '✓ Verified!';
      setTimeout(() => { location.href = 'dashboard.html'; }, 400);

    } catch (error) {
      console.error(error);
      isSubmittingAuth = false;
      err2.textContent = '❌ Invalid code. Try again.';
      btn.textContent = 'Verify & Login →';
      btn.disabled = false;
    }
  });


  // If already logged in, go to dashboard
  auth.onAuthStateChanged(user => {
    if (user && !isSubmittingAuth) {
      const email = user.email ? user.email.toLowerCase() : '';
      if (email === 'admin@niat.com' || email === 'jinkatulasiram@gmail.com') {
        location.href = 'admin.html';
      } else {
        location.href = 'dashboard.html';
      }
    }
  });
}

// =====================================================
// PASSWORD TOGGLE HELPER
// =====================================================
function setupPwToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  if (!input || !btn) return;
  btn.addEventListener('click', () => {
    input.type     = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
}

function switchToLogin() {
  document.getElementById('login-form')?.classList.remove('hidden');
  document.getElementById('register-form')?.classList.add('hidden');
  document.getElementById('otp-form')?.classList.add('hidden');
  document.getElementById('admin-login-form')?.classList.add('hidden');
  document.getElementById('tab-login')?.classList.add('active');
  document.getElementById('tab-register')?.classList.remove('active');
}
function switchToRegister() {
  document.getElementById('login-form')?.classList.add('hidden');
  document.getElementById('register-form')?.classList.remove('hidden');
  document.getElementById('otp-form')?.classList.add('hidden');
  document.getElementById('admin-login-form')?.classList.add('hidden');
  document.getElementById('tab-login')?.classList.remove('active');
  document.getElementById('tab-register')?.classList.add('active');
}
function switchToOtp() {
  document.getElementById('login-form')?.classList.add('hidden');
  document.getElementById('register-form')?.classList.add('hidden');
  document.getElementById('otp-form')?.classList.remove('hidden');
  document.getElementById('admin-login-form')?.classList.add('hidden');
  document.getElementById('tab-login')?.classList.remove('active');
  document.getElementById('tab-register')?.classList.remove('active');
}
function switchToAdmin() {
  document.getElementById('login-form')?.classList.add('hidden');
  document.getElementById('register-form')?.classList.add('hidden');
  document.getElementById('otp-form')?.classList.add('hidden');
  document.getElementById('admin-login-form')?.classList.remove('hidden');
  document.getElementById('tab-login')?.classList.remove('active');
  document.getElementById('tab-register')?.classList.remove('active');
}

// =====================================================
// EXPORT GLOBALS
// =====================================================
window.Auth              = Auth;
window.UsersDB           = UsersDB;
window.AttDB             = AttDB;
window.Settings          = Settings;
window.haversineDistance = haversineDistance;
window.initSidebar       = initSidebar;
window.showToast         = showToast;
window.todayStr          = todayStr;
window.formatDate        = formatDate;
window.hidePageLoader    = hidePageLoader;
window.switchToLogin     = switchToLogin;
window.switchToRegister  = switchToRegister;
window.switchToAdmin     = switchToAdmin;
