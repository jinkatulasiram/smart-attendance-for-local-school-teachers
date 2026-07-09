/* my-timetable.js — Teacher's Personal Weekly Timetable */
'use strict';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
let _session     = null;
let _allSlots    = {}; // { Monday: [{period,subject,className,time},...], ... }
let _currentView = 'day';
let _currentDay  = null;

document.addEventListener('DOMContentLoaded', async () => {

  _session = await Auth.requireAuth();
  hidePageLoader();
  initSidebar(_session);

  // Set page title by role
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  _currentDay    = dayNames[new Date().getDay()] === 'Sunday' ? 'Monday' : dayNames[new Date().getDay()];

  document.getElementById('tt-page-title').textContent = '📅 My Weekly Timetable';
  document.getElementById('tt-page-sub').textContent = 'Your assigned periods across all classes';

  await loadAllTimetableData();
  buildDayTabs();
  renderDayView(_currentDay);
});

// ── Load all timetable docs from Firestore ────────────────────
async function loadAllTimetableData() {
  _allSlots = {};
  DAYS.forEach(d => _allSlots[d] = []);

  const snap = await db.collection('timetables').get();
  if (snap.empty) return;

  snap.docs.forEach(doc => {
    const className = doc.id;
    const data      = doc.data();
    const slots     = data.slots || {};
    const periods   = data.periods || 8;

    DAYS.forEach(day => {
      const daySlots = slots[day] || {};
      for (let p = 1; p <= periods; p++) {
        const s = daySlots[p] || {};
        if (!s.subject && !s.teacher) continue;

        // Always only show periods assigned to the current user (including admin)
        if (s.teacher !== _session.name) continue;

        _allSlots[day].push({
          period:    p,
          subject:   s.subject || '',
          teacher:   s.teacher || '',
          className: className,
          time:      s.time    || ''
        });
      }
    });
  });

  // Sort each day by period number
  DAYS.forEach(d => _allSlots[d].sort((a, b) => a.period - b.period));
}

// ── Day Tabs ─────────────────────────────────────────────────
function buildDayTabs() {
  const tabsEl   = document.getElementById('day-tabs');
  const todayDay = _currentDay;
  tabsEl.innerHTML = '';

  DAYS.forEach(day => {
    const count  = _allSlots[day]?.length || 0;
    const isToday = day === todayDay;
    const btn = document.createElement('button');
    btn.className  = `day-tab ${isToday ? 'today-tab' : ''} ${day === _currentDay ? 'active' : ''}`;
    btn.id         = `tab-${day}`;
    btn.onclick    = () => switchDay(day);
    btn.innerHTML  = `${day.slice(0,3)} <span style="font-size:0.7rem;opacity:0.7;">(${count})</span>
      ${isToday ? '<span style="font-size:0.65rem;display:block;margin-top:2px;">Today</span>' : ''}`;
    tabsEl.appendChild(btn);
  });
}

function switchDay(day) {
  _currentDay = day;
  document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${day}`)?.classList.add('active');
  if (_currentView === 'day') renderDayView(day);
  else renderWeekView();
}

// ── Set View ─────────────────────────────────────────────────
window.setView = function(view) {
  _currentView = view;
  const dayBtn  = document.getElementById('view-day-btn');
  const weekBtn = document.getElementById('view-week-btn');
  if (view === 'day') {
    dayBtn.style.background  = 'linear-gradient(135deg,#7c3aed,#4f46e5)';
    dayBtn.style.color       = '#fff';
    dayBtn.style.border      = 'none';
    weekBtn.style.background = 'rgba(255,255,255,0.06)';
    weekBtn.style.color      = '#94a3b8';
    weekBtn.style.border     = '1px solid rgba(255,255,255,0.1)';
    renderDayView(_currentDay);
  } else {
    weekBtn.style.background = 'linear-gradient(135deg,#7c3aed,#4f46e5)';
    weekBtn.style.color      = '#fff';
    weekBtn.style.border     = 'none';
    dayBtn.style.background  = 'rgba(255,255,255,0.06)';
    dayBtn.style.color       = '#94a3b8';
    dayBtn.style.border      = '1px solid rgba(255,255,255,0.1)';
    renderWeekView();
  }
};

// ── Day View ─────────────────────────────────────────────────
function renderDayView(day) {
  const content  = document.getElementById('tt-teacher-content');
  const periods  = _allSlots[day] || [];
  const todayDay = (() => {
    const d = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return d[new Date().getDay()];
  })();
  const isToday = day === todayDay;

  if (periods.length === 0) {
    content.innerHTML = `
      <div class="no-periods-msg">
        <div class="np-icon">😴</div>
        <p style="color:#94a3b8;font-size:1rem;font-weight:600;">No periods on ${day}</p>
        <p style="color:#475569;font-size:0.85rem;margin-top:6px;">Enjoy your free time!</p>
      </div>`;
    return;
  }

  let html = `<div class="periods-grid">`;
  periods.forEach(r => {
    html += `
      <div class="period-card ${isToday ? 'today-card' : ''}">
        <div class="pc-num">Period ${r.period}</div>
        <div class="pc-subject">${r.subject || '—'}</div>
        <div class="pc-class">🏫 ${r.className}</div>
        ${r.time ? `<div class="pc-time">🕐 ${r.time}</div>` : ''}
        ${_session.role === 'admin' && r.teacher ? `<div style="font-size:0.76rem;color:#64748b;margin-top:6px;">👤 ${r.teacher}</div>` : ''}
      </div>`;
  });
  html += `</div>`;
  content.innerHTML = html;
}

// ── Week View ─────────────────────────────────────────────────
function renderWeekView() {
  const content = document.getElementById('tt-teacher-content');
  const todayDay = (() => {
    const d = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return d[new Date().getDay()];
  })();

  // Find max periods across all days
  let maxP = 0;
  DAYS.forEach(d => _allSlots[d]?.forEach(s => { if (s.period > maxP) maxP = s.period; }));
  if (maxP === 0) {
    content.innerHTML = `<div class="no-periods-msg"><div class="np-icon">📭</div><p style="color:#94a3b8;">No periods assigned yet for this week.</p></div>`;
    return;
  }

  let html = `<div class="week-table-wrap"><table class="week-table"><thead><tr>
    <th style="min-width:70px;">Period</th>`;
  DAYS.forEach(d => {
    const isToday = d === todayDay;
    html += `<th class="${isToday ? 'today-col' : ''}">${d.slice(0,3)}${isToday ? ' ★' : ''}</th>`;
  });
  html += `</tr></thead><tbody>`;

  for (let p = 1; p <= maxP; p++) {
    html += `<tr><td class="period-col">Period ${p}</td>`;
    DAYS.forEach(day => {
      const slot = _allSlots[day]?.find(s => s.period === p);
      const isToday = day === todayDay;
      if (slot) {
        html += `<td class="filled-slot ${isToday ? 'today-slot' : ''}">
          <div class="week-slot-subject">${slot.subject}</div>
          <div class="week-slot-class">${slot.className}</div>
          ${slot.time ? `<div class="week-slot-time">${slot.time}</div>` : ''}
          ${_session.role === 'admin' && slot.teacher ? `<div style="font-size:0.68rem;color:#64748b;margin-top:2px;">👤 ${slot.teacher}</div>` : ''}
        </td>`;
      } else {
        html += `<td></td>`;
      }
    });
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  content.innerHTML = html;
}
