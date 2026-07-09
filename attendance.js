/* attendance.js — Firebase GPS attendance (bulletproof rewrite) */
'use strict';

let _session = null;
let _cfg     = null;

document.addEventListener('DOMContentLoaded', async () => {

  // ── 1. Auth guard
  try {
    _session = await Auth.requireAuth();
  } catch (e) {
    location.href = 'login.html';
    return;
  }
  hidePageLoader();
  initSidebar(_session);

  // ── 2. Date label
  const dateEl = document.getElementById('att-date');
  if (dateEl) dateEl.textContent = todayStr();

  // ── 3. Load school config from Firestore
  try {
    _cfg = await Settings.get();
  } catch (e) {
    onScreenError('Could not load school settings. Check internet connection.', e);
    return;
  }

  if (!_cfg || !_cfg.schoolLat || !_cfg.schoolLng) {
    if (_session.role === 'admin') {
      onScreenError(
        'School Location Not Set',
        'You have not configured the school GPS location yet. Click the button below to set it to your current location right now.'
      );
      const adminBtn = document.getElementById('admin-set-loc-btn');
      if (adminBtn) {
        adminBtn.style.display = 'block';
        adminBtn.addEventListener('click', async () => {
          adminBtn.textContent = '📡 Detecting Location...';
          try {
            // First try IP fallback since it's faster and reliable without prompts
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            if (data.latitude && data.longitude) {
              await Settings.set({ schoolLat: data.latitude, schoolLng: data.longitude });
              adminBtn.textContent = '✓ Location Saved! Reloading...';
              setTimeout(() => location.reload(), 1000);
            } else throw new Error();
          } catch (e) {
            adminBtn.textContent = '❌ Failed. Please use Dashboard.';
          }
        });
      }
    } else {
      onScreenError(
        'School Location Not Set',
        'Admin has not configured the school GPS location yet. Please ask your admin to set it from the Dashboard.'
      );
    }
    return;
  }

  // ── 4. Check if already marked for THIS session
  try {
    const already = await AttDB.hasMarkedSession(_session.id);
    if (already) {
      const rec = await AttDB.getSessionRecord(_session.id);
      showMarkedState(rec);
      loadHistory(_session.id);
      return;
    }
  } catch (e) {
    onScreenError('Could not check today\'s attendance status.', e);
    return;
  }

  // ── 5. Load history (non-blocking)
  loadHistory(_session.id);

  // ── 6. GPS Check
  doGPSCheck();

  // Retry / Check Again buttons
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    resetUI();
    doGPSCheck();
  });
  document.getElementById('check-again-btn')?.addEventListener('click', () => {
    resetUI();
    doGPSCheck();
  });
});

/* ─────────────────────────────────────────
   GPS CHECK
───────────────────────────────────────── */
function doGPSCheck() {
  setStep(1, 'active');
  setStatusUI('Detecting Your Location…', 'Allow location access when browser asks', '📍');

  if (!navigator.geolocation) {
    onScreenError('GPS Not Available',
      'Your browser does not support GPS. Open this page on a smartphone.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    onGPSSuccess,
    onGPSError,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

async function onGPSSuccess(position) {
  const lat      = position.coords.latitude;
  const lng      = position.coords.longitude;
  const radius   = _cfg.radius || 100;
  const distance = haversineDistance(lat, lng, _cfg.schoolLat, _cfg.schoolLng);

  setStep(1, 'done');
  setStep(2, 'active');

  // Show coordinates
  const li = document.getElementById('location-info');
  if (li) li.style.display = 'block';
  setText('your-coords',   `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  setText('school-coords', `${_cfg.schoolLat.toFixed(5)}, ${_cfg.schoolLng.toFixed(5)}`);
  setText('your-distance', `${Math.round(distance)} meters`);

  if (distance <= radius) {
    setStep(2, 'done');
    setStatusUI(
      `You're Inside Campus ✅`,
      `You are ${Math.round(distance)}m from school — ready to mark attendance`,
      '✅'
    );
    showMarkBtn(lat, lng, distance);
  } else {
    setStep(2, 'error');
    onScreenError(
      'Outside Campus Range',
      `You are ${Math.round(distance)}m away from school.\nYou must be within ${radius}m to mark attendance.\nPlease physically come to school and try again.`
    );
    const btn = document.getElementById('check-again-btn');
    if (btn) btn.style.display = 'block';
  }
}

async function onGPSError(err) {
  setStatusUI('GPS Blocked', 'Trying approximate IP location...', '📡');
  try {
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    if (data.latitude && data.longitude) {
      processLocation({ coords: { latitude: data.latitude, longitude: data.longitude }});
      return;
    }
    throw new Error();
  } catch (ipErr) {
    setStep(1, 'error');
    const msgs = {
      1: 'Location permission denied. Both GPS and IP location failed.',
      2: 'Your GPS signal is unavailable. Move to an open area.',
      3: 'Location request timed out. Check GPS is on.'
    };
    onScreenError('Location Error', msgs[err.code] || err.message);
    const btn = document.getElementById('check-again-btn');
    if (btn) btn.style.display = 'block';
  }
}

/* ─────────────────────────────────────────
   MARK BUTTON
───────────────────────────────────────── */
function showMarkBtn(lat, lng, distance) {
  const markBtn = document.getElementById('att-mark-btn');
  if (!markBtn) return;
  markBtn.style.display = 'block';
  const sessionName = AttDB.getCurrentSession() === 'morning' ? 'Morning' : 'Afternoon';
  markBtn.textContent   = `Mark ${sessionName} Present ✓`;
  markBtn.disabled      = false;

  markBtn.onclick = async () => {
    markBtn.textContent = '⏳ Saving…';
    markBtn.disabled    = true;

    try {
      // Direct Firestore write — simple and direct
      const record = {
        userId:    _session.id,
        userName:  _session.name,
        userRoll:  _session.rollNo    || '',
        userClass: _session.className || '',
        date:      new Date().toISOString().slice(0, 10),
        time:      new Date().toLocaleTimeString('en-IN'),
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        lat, lng,
        distanceM: Math.round(distance),
        status:    'present',
        session:   AttDB.getCurrentSession()
      };

      console.log('📤 Writing attendance:', record);
      const ref = await window.db.collection('attendance').add(record);
      console.log('✅ Saved! Doc ID:', ref.id);

      setStep(3, 'done');
      showMarkedState({ ...record, id: ref.id, time: new Date().toLocaleTimeString('en-IN') });
      loadHistory(_session.id);
      showToast('✅ Attendance saved to cloud! Redirecting...', 'success');
      
      // Auto redirect to dashboard after a brief delay so they see the success message
      setTimeout(() => { location.href = 'dashboard.html'; }, 1500);

    } catch (err) {
      console.error('❌ Firestore write error:', err.code, err.message);

      let msg = err.message || 'Unknown error';
      if (err.code === 'permission-denied') {
        msg = '🔒 Permission denied.\n\nGo to Firebase Console → Firestore → Rules\nand publish: allow read, write: if request.auth != null;';
      } else if (err.code === 'unavailable' || err.code === 'network-request-failed') {
        msg = '📶 No internet connection. Check your network and try again.';
      } else if (err.code === 'unauthenticated') {
        msg = '🔑 Your session expired. Please logout and login again.';
      }

      onScreenError('Save Failed ❌', msg);
      markBtn.textContent = '↩ Try Again';
      markBtn.disabled    = false;
    }
  };
}

/* ─────────────────────────────────────────
   HISTORY
───────────────────────────────────────── */
async function loadHistory(userId) {
  try {
    const records = await AttDB.getForUser(userId);
    const stats   = await AttDB.getStats(userId);

    setText('hist-present', stats.present);
    setText('hist-absent',  stats.absent);
    setText('hist-pct',     stats.pct + '%');

    const list = document.getElementById('history-list');
    if (!list) return;

    if (records.length === 0) {
      list.innerHTML = '<p class="empty-text" style="color:var(--muted);font-size:0.85rem;padding:12px 0;">No attendance records yet</p>';
      return;
    }
    list.innerHTML = records.slice(0, 30).map(r => `
      <div class="hist-row">
        <span class="hist-date">${r.date}</span>
        <span class="badge-present">Present</span>
        <span class="hist-session" style="text-transform:capitalize;">${r.session || '—'}</span>
        <span class="hist-time">${r.time || ''}</span>
      </div>
    `).join('');
  } catch (e) {
    console.warn('History load error:', e.message);
  }
}

/* ─────────────────────────────────────────
   UI HELPERS
───────────────────────────────────────── */
function showMarkedState(record) {
  hide('att-mark-btn');
  hide('att-error');
  hide('check-again-btn');
  show('already-marked');
  setStep(1, 'done');
  setStep(2, 'done');
  setStep(3, 'done');
  setStatusUI('Attendance Already Marked! 🎉',
    'Your attendance is recorded for today.', '✅');

  const detEl = document.getElementById('am-details');
  if (detEl && record) {
    detEl.innerHTML =
      `Date: ${record.date || '—'}<br>` +
      `Time: ${record.time || '—'}<br>` +
      `Distance from school: ${record.distanceM ?? '—'}m`;
  }
}

function onScreenError(title, errOrMsg) {
  const msg = typeof errOrMsg === 'string'
    ? errOrMsg
    : `${errOrMsg.code ? '[' + errOrMsg.code + '] ' : ''}${errOrMsg.message}`;
  console.error('onScreenError:', title, msg);
  show('att-error');
  hide('att-mark-btn');
  setText('err-title', title);
  setText('err-msg',   msg);
  setStatusUI(title, msg, '⚠️');
}

function resetUI() {
  hide('att-error');
  hide('att-mark-btn');
  hide('already-marked');
  hide('check-again-btn');
  const li = document.getElementById('location-info');
  if (li) li.style.display = 'none';
  [1, 2, 3].forEach(n => setStep(n, ''));
  setStatusUI('Checking Your Location…', 'Please wait…', '📍');
}

function setStep(num, state) {
  const ids  = ['dot-loc', 'dot-range', 'dot-mark'];
  const dot  = document.getElementById(ids[num - 1]);
  if (!dot) return;
  dot.className   = 'step-dot ' + state;
  dot.textContent = state === 'done' ? '✓' : num;
}

function setStatusUI(title, sub, icon) {
  setText('att-status-title', title);
  setText('att-status-sub',   sub);
  setText('att-icon',         icon);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
