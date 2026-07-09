/* dashboard.js — Firebase-powered dashboard */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {

  // Auth guard — wait for Firebase
  const session = await Auth.requireAuth();
  hidePageLoader();
  initSidebar(session);

  // Greet
  const hour  = new Date().getHours();
  const greet = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const gEl   = document.getElementById('dash-greeting');
  const dEl   = document.getElementById('dash-date');
  const hEl   = document.getElementById('header-date');
  if (gEl) gEl.textContent = `${greet}, ${session.name}! 👋`;
  if (dEl) dEl.textContent = todayStr();
  if (hEl) hEl.textContent = new Date().toLocaleDateString('en-IN');

  // ---- Load stats & table ----
  await loadAll(session);

  // ---- Real-time listener for today's attendance ----
  const today = new Date().toISOString().slice(0, 10);
  window.attendanceUnsubscribe = db.collection('attendance').where('date', '==', today)
    .onSnapshot(async () => {
      // DEBOUNCE: Prevent 100s of rapid re-renders if 100 users mark attendance at once
      clearTimeout(window.snapshotTimer);
      window.snapshotTimer = setTimeout(async () => {
        await loadAll(session);
      }, 1500);
    });

  // ---- Announcements ----
  initAnnouncements(session);

  // ---- Today's Timetable ----
  loadTodayTimetable(session);

  // ---- Auto-refresh at 11:00 PM every night ----
  scheduleNightRefresh(session);
});

// =====================================================
// TODAY'S TIMETABLE
// =====================================================
async function loadTodayTimetable(session) {
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayDay = dayNames[new Date().getDay()];

  const dayLabel = document.getElementById('tt-today-day');
  const content  = document.getElementById('tt-today-content');
  if (dayLabel) dayLabel.textContent = todayDay;

  // Sunday — no classes
  if (todayDay === 'Sunday') {
    if (content) content.innerHTML = `<p style="color:#64748b;font-size:0.9rem;text-align:center;">🎉 It's Sunday — No classes today!</p>`;
    return;
  }

  try {
    const snap = await db.collection('timetables').get();
    if (snap.empty) {
      if (content) content.innerHTML = `<p style="color:#64748b;font-size:0.9rem;text-align:center;">No timetable set yet. Admin can add one via the Timetable page.</p>`;
      return;
    }

    if (session.role === 'admin') {
      // Admin sees ALL classes for today
      let html = '';
      snap.docs.forEach(doc => {
        const className = doc.id;
        const data      = doc.data();
        const slots     = data.slots?.[todayDay] || {};
        const periods   = data.periods || 8;
        const hasPeriods = Object.values(slots).some(s => s.subject || s.teacher);
        if (!hasPeriods) return;

        html += `
          <div style="margin-bottom:20px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:16px;">
            <h4 style="color:#a78bfa;font-size:0.95rem;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
               <span style="font-size:1.1rem;">📚</span> ${className}
            </h4>
            <div style="display:flex; overflow-x:auto; gap:12px; padding-bottom:8px; scrollbar-width:thin;">
        `;
        for (let p = 1; p <= periods; p++) {
          const s = slots[p] || {};
          if (!s.subject && !s.teacher) continue;
          html += `
            <div style="min-width:140px; background:rgba(124,58,237,0.08); border:1px solid rgba(124,58,237,0.18);
              border-radius:10px; padding:12px; text-align:center; flex-shrink:0;">
              <div style="font-size:0.72rem;color:#64748b;margin-bottom:4px; white-space:nowrap;">Period ${p}${s.time ? ' · ' + s.time : ''}</div>
              <div style="font-weight:700;color:#f1f5f9;font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${s.subject || ''}">${s.subject || '—'}</div>
              ${s.teacher ? `<div style="font-size:0.78rem;color:#94a3b8;margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${s.teacher}">${s.teacher}</div>` : ''}
            </div>`;
        }
        html += `</div></div>`;
      });

      if (!html) html = `<p style="color:#64748b;font-size:0.9rem;text-align:center;">No periods assigned for ${todayDay} yet. Go to <a href="timetable.html" style="color:#7c3aed;">Timetable Manager</a> to set up.</p>`;

      // Add Send Timetable button for admin
      html += `
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
          <button id="btn-send-timetable" onclick="sendTimetableToTeachers()"
            style="display:inline-flex;align-items:center;gap:10px;
            background:linear-gradient(135deg,#10b981,#059669);color:#fff;
            border:none;border-radius:12px;padding:14px 32px;
            font-size:1rem;font-weight:700;cursor:pointer;
            box-shadow:0 6px 20px rgba(16,185,129,0.35);
            animation:pulse-send 2s infinite;
            font-family:inherit;transition:transform 0.2s;">
            📤 Send Timetable to All Teachers
          </button>
          <p style="color:#64748b;font-size:0.78rem;margin-top:8px;">Teachers will see a notification on their dashboard</p>
        </div>
        <style>
          @keyframes pulse-send {
            0%,100% { box-shadow:0 6px 20px rgba(16,185,129,0.35); transform:scale(1); }
            50% { box-shadow:0 6px 30px rgba(16,185,129,0.6); transform:scale(1.02); }
          }
        </style>
      `;

      if (content) content.innerHTML = html;

    } else {
      // Teacher sees only their own periods across all classes
      let rows = [];
      snap.docs.forEach(doc => {
        const className = doc.id;
        const data      = doc.data();
        const slots     = data.slots?.[todayDay] || {};
        const periods   = data.periods || 8;
        for (let p = 1; p <= periods; p++) {
          const s = slots[p] || {};
          if (s.teacher === session.name) {
            rows.push({ period: p, className, subject: s.subject, time: s.time });
          }
        }
      });

      if (rows.length === 0) {
        if (content) content.innerHTML = `<p style="color:#64748b;font-size:0.9rem;text-align:center;">No periods assigned to you for ${todayDay}.</p>`;
        return;
      }

      // Sort by period number
      rows.sort((a, b) => a.period - b.period);

      let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;">`;
      rows.forEach(r => {
        html += `
          <div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.22);
            border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:0.72rem;color:#7c3aed;font-weight:700;margin-bottom:6px;letter-spacing:0.3px;">
              PERIOD ${r.period}${r.time ? ' · ' + r.time : ''}
            </div>
            <div style="font-weight:700;color:#f1f5f9;font-size:1rem;">${r.subject || '—'}</div>
            <div style="font-size:0.8rem;color:#94a3b8;margin-top:4px;">${r.className}</div>
          </div>`;
      });
      html += `</div>`;
      if (content) content.innerHTML = html;
    }

  } catch (e) {
    console.error(e);
    if (content) content.innerHTML = `<p style="color:#ef4444;font-size:0.9rem;text-align:center;">Error loading timetable.</p>`;
  }
}


// Schedule a refresh exactly at 11:00 PM tonight (and every night after)
function scheduleNightRefresh(session) {
  const now     = new Date();
  const refresh = new Date();
  refresh.setHours(23, 0, 0, 0); // 11:00 PM tonight

  // If it's already past 11 PM today, schedule for tomorrow 11 PM
  if (now >= refresh) {
    refresh.setDate(refresh.getDate() + 1);
  }

  const msUntilRefresh = refresh.getTime() - now.getTime();

  setTimeout(async () => {
    // Update date label
    const dEl = document.getElementById('dash-date');
    const hEl = document.getElementById('header-date');
    if (dEl) dEl.textContent = todayStr();
    if (hEl) hEl.textContent = new Date().toLocaleDateString('en-IN');

    // Reload all data (attendance resets to new day's records)
    await loadAll(session);

    // Re-attach Firestore listener with new today's date (clean up old one)
    if (window.attendanceUnsubscribe) window.attendanceUnsubscribe();
    const newToday = new Date().toISOString().slice(0, 10);
    window.attendanceUnsubscribe = db.collection('attendance').where('date', '==', newToday)
      .onSnapshot(async () => {
        clearTimeout(window.snapshotTimer);
        window.snapshotTimer = setTimeout(async () => {
          await loadAll(session);
        }, 1500);
      });

    showToast('📅 Attendance refreshed for the new day!', 'info');

    // Schedule again for the next night at 11 PM
    scheduleNightRefresh(session);
  }, msUntilRefresh);
}



async function loadAll(session) {
  await Promise.all([
    loadStats(session),
    loadTodayTable(session),
    loadCharts(session)
  ]);
}

async function loadStats(session) {
  if (session.role === 'admin') {
    const [todayRec, teachers] = await Promise.all([
      AttDB.getToday(),
      UsersDB.getTeachers()
    ]);

    const total = teachers.length;
    // For admin, present today means they marked at least 1 session
    const presentSet = new Set(todayRec.map(r => r.userId));
    const present = [...presentSet].filter(id => teachers.some(t => t.id === id)).length;
    const absent = Math.max(0, total - present);

    animNum('sc-present-val', present);
    animNum('sc-absent-val', absent);
    
    // Change the 3rd card to "Total Teachers" for Admin
    document.querySelector('#sc-pct .card-subtitle').textContent = 'Total Teachers';
    document.querySelector('#sc-pct .scard-icon').textContent = '👥';
    const pctSpan = document.querySelector('#sc-pct-val span');
    if (pctSpan) pctSpan.textContent = total;
    const deltaEl = document.getElementById('sc-pct-delta');
    if (deltaEl) deltaEl.style.display = 'none';

  } else {
    // TEACHER LOGIC
    // Change labels for teacher
    document.querySelector('#sc-present .scard-label').textContent = 'Presented Days';
    document.querySelector('#sc-absent .scard-label').textContent = 'Absented Days';
    document.querySelector('#sc-pct .card-subtitle').textContent = 'Monthly Progress';
    document.querySelector('#sc-pct .scard-icon').textContent = '📊';
    const deltaEl = document.getElementById('sc-pct-delta');
    if (deltaEl) deltaEl.style.display = 'inline';

    // Get teacher's monthly records
    const allRecords = await AttDB.getForUser(session.id);
    
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const todayDate = today.getDate();
    const todayStr = today.toISOString().slice(0, 10);

    // Count today's sessions (still useful internally if needed)
    const todaySessions = allRecords.filter(r => r.date === todayStr).length;

    // Find actual school working days this month by checking global attendance
    const globalRecords = await AttDB.getAll();
    const monthPrefix = todayStr.slice(0, 7); // e.g. "2026-06"
    
    const workingDaysThisMonth = new Set();
    const workingDaysYesterday = new Set();
    
    globalRecords.forEach(r => {
      if (r.date.startsWith(monthPrefix) && r.date <= todayStr) {
        workingDaysThisMonth.add(r.date);
        if (r.date < todayStr) workingDaysYesterday.add(r.date);
      }
    });

    // Calculate monthly percentage and days for this user
    let presentedDays = 0;
    let absentedDays = 0;
    let totalSessionsMarked = 0;
    let totalSessionsYesterday = 0;

    workingDaysThisMonth.forEach(dStr => {
      const sessionsThatDay = allRecords.filter(r => r.date === dStr).length;
      totalSessionsMarked += sessionsThatDay;
      presentedDays += (sessionsThatDay * 0.5); // 1 session = 0.5 days

      if (dStr < todayStr) {
        totalSessionsYesterday += sessionsThatDay;
        absentedDays += (2 - sessionsThatDay) * 0.5;
      }
    });

    // Calculate total fixed working days in the entire month (excluding Sundays)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let fixedWorkingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      if (d.getDay() !== 0) fixedWorkingDays++;
    }
    const fixedMaxSessions = fixedWorkingDays * 2;

    let monthlyPct = 0;
    if (fixedMaxSessions > 0) {
      monthlyPct = Math.round((totalSessionsMarked / fixedMaxSessions) * 100);
    }

    let pctYesterday = 0;
    if (fixedMaxSessions > 0) {
      pctYesterday = Math.round((totalSessionsYesterday / fixedMaxSessions) * 100);
    }

    animNum('sc-present-val', presentedDays);
    animNum('sc-absent-val', absentedDays);
    const pctEl = document.querySelector('#sc-pct-val span');
    if (pctEl) pctEl.textContent = monthlyPct + '%';

    // deltaEl is already declared at the top of this block
    if (deltaEl) {
      const delta = monthlyPct - pctYesterday;
      if (delta > 0) {
        deltaEl.textContent = `↑ +${delta}%`;
        deltaEl.style.color = '#10b981';
      } else if (delta < 0) {
        deltaEl.textContent = `↓ ${delta}%`;
        deltaEl.style.color = '#ef4444';
      } else {
        deltaEl.textContent = `— 0%`;
        deltaEl.style.color = '#94a3b8';
      }
    }
  }
}

window._animFrames = window._animFrames || {};
function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window._animFrames[id]) cancelAnimationFrame(window._animFrames[id]);
  
  let cur = 0;
  const dur   = 800;
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / dur, 1);
    cur = Math.round(target * (1 - (1 - p) ** 3));
    el.textContent = cur;
    if (p < 1) {
      window._animFrames[id] = requestAnimationFrame(step);
    } else {
      delete window._animFrames[id];
    }
  }
  window._animFrames[id] = requestAnimationFrame(step);
}

async function loadTodayTable(session) {
  const tbody = document.getElementById('today-tbody');
  if (!tbody) return;

  let records = await AttDB.getToday();
  if (session.role === 'student')
    records = records.filter(r => r.userId === session.id);

  if (records.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="empty-row">No attendance records for today</td></tr>';
    return;
  }

  tbody.innerHTML = records.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${r.userName || '—'}</strong></td>
      <td style="font-family:'Fira Code',monospace;font-size:0.8rem;">${r.userRoll || '—'}</td>
      <td>${r.userClass || '—'}</td>
      <td>${r.time}</td>
      <td style="text-transform:capitalize;font-weight:500;color:var(--brand);">${r.session || '—'}</td>
      <td><span class="badge-present">Present</span></td>
      <td><span style="font-size:0.78rem;color:var(--muted);">${r.distanceM}m away</span></td>
    </tr>
  `).join('');

  document.getElementById('today-search')?.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

let donutChart, weekChart;

async function loadCharts(session) {
  if (session.role === 'admin') {
    document.getElementById('admin-charts').style.display = 'flex';
    document.getElementById('teacher-calendar').style.display = 'none';

    const [todayRec, teachers] = await Promise.all([
      AttDB.getToday(),
      UsersDB.getTeachers()
    ]);
    const total   = teachers.length;
    // Get unique users who marked attendance today
    const presentSet = new Set(todayRec.filter(r => teachers.some(s => s.id === r.userId)).map(r => r.userId));
    const present = presentSet.size;
    const absent  = Math.max(0, total - present);

  // Donut
  const donutCtx = document.getElementById('donutChart')?.getContext('2d');
  if (donutCtx) {
    if (donutChart) donutChart.destroy();
    donutChart = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Absent'],
        datasets: [{
          data: [present, absent],
          backgroundColor: ['rgba(16,185,129,0.8)', 'rgba(239,68,68,0.6)'],
          borderColor: ['#10b981', '#ef4444'],
          borderWidth: 2, hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 } } } },
        cutout: '68%'
      }
    });
  }

    // Weekly bar
    const weekCtx = document.getElementById('weekChart')?.getContext('2d');
    if (weekCtx) {
      const allAtt      = await AttDB.getAll();
      const labels      = [];
      const presentData = [];
      const absentData  = [];

      for (let i = 6; i >= 0; i--) {
        const d      = new Date(); d.setDate(d.getDate() - i);
        const dKey   = d.toISOString().slice(0, 10);
        const dayRec = allAtt.filter(r =>
          r.date === dKey && teachers.some(s => s.id === r.userId));
        labels.push(d.toLocaleDateString('en-IN', { weekday: 'short' }));
        presentData.push(dayRec.length);
        absentData.push(Math.max(0, total - dayRec.length));
      }

      if (weekChart) weekChart.destroy();
      weekChart = new Chart(weekCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Present', data: presentData, backgroundColor: 'rgba(16,185,129,0.7)', borderColor: '#10b981', borderWidth: 1, borderRadius: 0 },
            { label: 'Absent',  data: absentData,  backgroundColor: 'rgba(239,68,68,0.5)',  borderColor: '#ef4444', borderWidth: 1, borderRadius: 0 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Outfit' } } } },
          scales: {
            x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { stacked: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } }
          }
        }
      });
    }
  } else {
    // TEACHER VIEW - Monthly Calendar
    document.getElementById('admin-charts').style.display = 'none';
    document.getElementById('teacher-calendar').style.display = 'block';

    const records = await AttDB.getForUser(session.id);
    const dateMap = {};
    // Group records by date
    records.forEach(r => {
      if (!dateMap[r.date]) dateMap[r.date] = new Set();
      if (r.session) dateMap[r.date].add(r.session);
    });

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('cal-month-name').textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const grid = document.getElementById('calendar-grid');
    
    // Clear old days (keep the 7 headers)
    while (grid.children.length > 7) {
      grid.removeChild(grid.lastChild);
    }

    // Empty slots for start of month
    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div');
      el.style.minHeight = '48px';
      grid.appendChild(el);
    }

    // Days
    const todayKey = today.toISOString().slice(0, 10);
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const dKey = d.toISOString().slice(0, 10);
      
      let bgColor = 'rgba(255,255,255,0.03)';
      let color = '#64748b'; // default gray

      if (dKey > todayKey || d.getDay() === 0) { // future or Sunday
        bgColor = 'rgba(255,255,255,0.02)';
        color = '#475569';
      } else {
        const sessions = dateMap[dKey] ? dateMap[dKey].size : 0;
        if (sessions >= 2) {
          bgColor = '#10b981'; // Solid Green
          color = '#ffffff';
        } else if (sessions === 1) {
          bgColor = '#34d399'; // Light Green
          color = '#ffffff';
        } else if (dKey <= todayKey) {
          bgColor = 'rgba(239,68,68,0.15)'; // Red
          color = '#ef4444';
        }
      }

      const el = document.createElement('div');
      el.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        border-radius: 8px; min-height: 48px; font-weight: 600;
        background: ${bgColor}; color: ${color}; border: 1px solid rgba(255,255,255,0.05);
      `;
      if (dKey === todayKey) el.style.border = '2px solid var(--brand)';
      el.textContent = day;
      grid.appendChild(el);
    }
  }
}

// =====================================================
// ANNOUNCEMENTS
// =====================================================
function initAnnouncements(session) {
  const adminBox  = document.getElementById('admin-announce-box');
  const feed      = document.getElementById('announce-feed');
  const input     = document.getElementById('announce-input');
  const postBtn   = document.getElementById('btn-post-announce');

  // Show the post box only for Admins
  if (session.role === 'admin' && adminBox) {
    adminBox.style.display = 'block';
  }

  // Real-time feed from Firestore
  db.collection('announcements')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .onSnapshot(snap => {
      if (!feed) return;
      if (snap.empty) {
        feed.innerHTML = '<p style="color:#64748b;font-size:0.9rem;text-align:center;">No announcements yet.</p>';
        return;
      }
      feed.innerHTML = '';
      snap.docs.forEach(doc => {
        const d = doc.data();
        const dt = d.createdAt ? new Date(d.createdAt.toDate ? d.createdAt.toDate() : d.createdAt).toLocaleString('en-IN') : '';
        const card = document.createElement('div');
        card.style.cssText = `
          background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);
          border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;gap:6px;
        `;
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.8rem;color:#7c3aed;font-weight:600;">📢 Admin Announcement</span>
            <span style="font-size:0.75rem;color:#64748b;">${dt}</span>
            ${session.role === 'admin' ? `<button onclick="deleteAnnouncement('${doc.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.8rem;">🗑 Delete</button>` : ''}
          </div>
          ${d.message ? `<p style="color:#f1f5f9;font-size:0.95rem;line-height:1.6;margin:8px 0 0;">${d.message}</p>` : ''}
          ${d.imageUrl ? `<img src="${d.imageUrl}" alt="Announcement" style="max-width:100%;border-radius:10px;margin-top:12px;border:1px solid rgba(255,255,255,0.1);"/>` : ''}
        `;
        feed.appendChild(card);
      });
    });

  // Post Announcement (Admin only)
  postBtn?.addEventListener('click', async () => {
    const msg = input?.value.trim();
    if (!msg) return;
    postBtn.textContent = 'Posting...';
    postBtn.disabled = true;
    await db.collection('announcements').add({
      message:   msg,
      postedBy:  session.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = '';
    postBtn.textContent = '📤 Post Announcement';
    postBtn.disabled = false;
    showToast('Announcement posted!', 'success');
  });
}

window.deleteAnnouncement = async function(id) {
  if (!confirm('Delete this announcement?')) return;
  await db.collection('announcements').doc(id).delete();
  showToast('Announcement deleted.', 'info');
};

// ── Send Timetable broadcast to all teachers ──────────────────
window.sendTimetableToTeachers = async function() {
  const btn = document.getElementById('btn-send-timetable');
  if (btn) {
    btn.textContent = 'Sending...';
    btn.disabled    = true;
    btn.style.animation = 'none';
  }

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayDay = dayNames[new Date().getDay()];

  try {
    // Post as an announcement so it appears in the feed
    await db.collection('announcements').add({
      message:   `📅 Today's Timetable (${todayDay}) has been shared! Check the "Today's Timetable" section on your dashboard.`,
      imageUrl:  null,
      postedBy:  'Admin',
      type:      'timetable_broadcast',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (btn) {
      btn.innerHTML   = '✅ Timetable Sent!';
      btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
      btn.style.opacity = '0.7';
    }
    showToast('✅ Timetable broadcast sent to all teachers!', 'success');

    // Reset button after 4 seconds
    setTimeout(() => {
      if (btn) {
        btn.innerHTML   = '📤 Send Timetable to All Teachers';
        btn.disabled    = false;
        btn.style.opacity = '1';
        btn.style.animation = 'pulse-send 2s infinite';
      }
    }, 4000);

  } catch (e) {
    console.error(e);
    showToast('Error sending timetable: ' + e.message, 'error');
    if (btn) {
      btn.innerHTML = '📤 Send Timetable to All Teachers';
      btn.disabled  = false;
      btn.style.animation = 'pulse-send 2s infinite';
    }
  }
};
