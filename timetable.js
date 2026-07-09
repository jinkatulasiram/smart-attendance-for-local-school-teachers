/* timetable.js — Class-wise Daily Timetable Manager */
'use strict';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_PERIODS = 8;

let _session      = null;
let _teachers     = [];
let _currentClass = null;
let _timetable    = {}; // { periods: 8, slots: { Mon: { 1: {subject,teacher,time}, ... } } }
let _editCtx      = null; // { day, period }

document.addEventListener('DOMContentLoaded', async () => {

  // Auth guard — admin only
  _session = await Auth.requireAuth(['admin']);
  hidePageLoader();
  initSidebar(_session);

  // Load teachers for dropdown
  _teachers = await UsersDB.getTeachers();

  // Load class list
  await loadClassList();

  // Class selector change
  document.getElementById('tt-class-select').addEventListener('change', async (e) => {
    _currentClass = e.target.value || null;
    if (_currentClass) await loadTimetable(_currentClass);
    else renderEmptyState();
  });

  // Add class
  document.getElementById('btn-add-class').addEventListener('click', async () => {
    const name = prompt('Enter new class name (e.g. Class 10-A, Class 11-B):');
    if (!name || !name.trim()) return;
    const className = name.trim();
    await db.collection('timetables').doc(className).set({
      periods: DEFAULT_PERIODS,
      slots: {},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await loadClassList(className);
    showToast(`Class "${className}" created!`, 'success');
  });

  // Delete class
  document.getElementById('btn-del-class').addEventListener('click', async () => {
    if (!_currentClass) { showToast('Select a class first.', 'error'); return; }
    if (!confirm(`Delete timetable for "${_currentClass}"? This cannot be undone.`)) return;
    await db.collection('timetables').doc(_currentClass).delete();
    _currentClass = null;
    await loadClassList();
    renderEmptyState();
    showToast('Class deleted.', 'info');
  });

  // Modal buttons
  document.getElementById('modal-save-btn').addEventListener('click', savePeriod);
  document.getElementById('modal-clear-btn').addEventListener('click', clearPeriod);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('tt-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('tt-modal')) closeModal();
  });
});

// ── Load class dropdown ──────────────────────────────────────
async function loadClassList(selectClass = null) {
  const snap = await db.collection('timetables').orderBy('createdAt', 'asc').get();
  const sel  = document.getElementById('tt-class-select');
  sel.innerHTML = '<option value="">— Select a Class —</option>';
  snap.docs.forEach(doc => {
    const opt = document.createElement('option');
    opt.value = doc.id;
    opt.textContent = doc.id;
    if (doc.id === (selectClass || _currentClass)) opt.selected = true;
    sel.appendChild(opt);
  });
  if (selectClass || _currentClass) {
    _currentClass = selectClass || _currentClass;
    await loadTimetable(_currentClass);
  }
}

// ── Load & Render Timetable ──────────────────────────────────
async function loadTimetable(className) {
  const doc = await db.collection('timetables').doc(className).get();
  if (!doc.exists) { renderEmptyState(); return; }
  _timetable = doc.data();
  if (!_timetable.periods) _timetable.periods = DEFAULT_PERIODS;
  if (!_timetable.slots)   _timetable.slots   = {};
  renderGrid();
}

// ── Render the timetable grid ────────────────────────────────
function renderGrid() {
  const content  = document.getElementById('tt-content');
  const periods  = _timetable.periods || DEFAULT_PERIODS;
  const slots    = _timetable.slots   || {};

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:12px;">
      <h3 style="color:#f1f5f9;font-size:1.1rem;">📚 ${_currentClass}</h3>
      <div style="display:flex;gap:10px;align-items:center;">
        <span style="color:#64748b;font-size:0.85rem;">Periods: <strong style="color:#a78bfa;">${periods}</strong></span>
        <button onclick="addPeriod()" class="btn-add-period">+ Add Period</button>
        ${periods > 1 ? `<button onclick="removePeriod()" class="btn-add-period" style="color:#ef4444;">− Remove Last</button>` : ''}
      </div>
    </div>
    <div class="tt-grid-wrap">
    <table class="tt-grid">
      <thead>
        <tr>
          <th style="min-width:80px;">Period</th>
          ${DAYS.map(d => `<th>${d}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  for (let p = 1; p <= periods; p++) {
    html += `<tr>
      <td class="tt-period-label">Period ${p}</td>`;
    DAYS.forEach(day => {
      const slot    = slots[day]?.[p] || {};
      const filled  = slot.subject || slot.teacher;
      html += `
        <td>
          <div class="tt-cell ${filled ? 'filled' : ''}" onclick="openModal('${day}', ${p})">
            ${filled
              ? `<span class="tt-subject">${slot.subject || ''}</span>
                 <span class="tt-teacher">${slot.teacher || ''}</span>
                 ${slot.time ? `<span style="font-size:0.7rem;color:#475569;">${slot.time}</span>` : ''}`
              : `<span class="tt-empty-hint">+ Assign</span>`}
          </div>
        </td>`;
    });
    html += `</tr>`;
  }

  html += `
      </tbody>
    </table>
    </div>`;

  content.innerHTML = html;
}

// ── Add / Remove period ──────────────────────────────────────
async function addPeriod() {
  _timetable.periods = (_timetable.periods || DEFAULT_PERIODS) + 1;
  await saveTimetableDoc();
  renderGrid();
}
async function removePeriod() {
  const p = _timetable.periods;
  if (p <= 1) return;
  // Clear last period slots
  DAYS.forEach(day => {
    if (_timetable.slots[day]) delete _timetable.slots[day][p];
  });
  _timetable.periods = p - 1;
  await saveTimetableDoc();
  renderGrid();
}

// ── Modal ────────────────────────────────────────────────────
function openModal(day, period) {
  _editCtx = { day, period };
  const slot = _timetable.slots?.[day]?.[period] || {};

  document.getElementById('modal-period-label').textContent = `${day} — Period ${period}`;
  document.getElementById('modal-subject').value = slot.subject || '';
  document.getElementById('modal-time').value    = slot.time    || '';

  // Populate teacher dropdown
  const sel = document.getElementById('modal-teacher');
  sel.innerHTML = '<option value="">— No teacher assigned —</option>';
  _teachers.forEach(t => {
    const opt = document.createElement('option');
    opt.value       = t.name;
    opt.textContent = `${t.name}${t.className ? ' (' + t.className + ')' : ''}`;
    if (slot.teacher === t.name) opt.selected = true;
    sel.appendChild(opt);
  });

  document.getElementById('tt-modal').style.display = 'flex';
  document.getElementById('modal-subject').focus();
}

function closeModal() {
  document.getElementById('tt-modal').style.display = 'none';
  _editCtx = null;
}

async function savePeriod() {
  if (!_editCtx) return;
  const { day, period } = _editCtx;
  const subject = document.getElementById('modal-subject').value.trim();
  const teacher = document.getElementById('modal-teacher').value;
  const time    = document.getElementById('modal-time').value.trim();

  if (!_timetable.slots[day]) _timetable.slots[day] = {};
  _timetable.slots[day][period] = { subject, teacher, time };

  await saveTimetableDoc();
  closeModal();
  renderGrid();
  showToast('Period saved!', 'success');
}

async function clearPeriod() {
  if (!_editCtx) return;
  const { day, period } = _editCtx;
  if (_timetable.slots[day]) delete _timetable.slots[day][period];
  await saveTimetableDoc();
  closeModal();
  renderGrid();
  showToast('Period cleared.', 'info');
}

// ── Save to Firestore ────────────────────────────────────────
async function saveTimetableDoc() {
  await db.collection('timetables').doc(_currentClass).set({
    periods:   _timetable.periods,
    slots:     _timetable.slots
  }, { merge: true });
}

// ── Empty state ──────────────────────────────────────────────
function renderEmptyState() {
  document.getElementById('tt-content').innerHTML = `
    <div class="tt-empty-state">
      <div class="tt-es-icon">📅</div>
      <p>Select or create a class above to manage its timetable</p>
    </div>`;
}

// Expose to global (used in inline onclick)
window.openModal     = openModal;
window.addPeriod     = addPeriod;
window.removePeriod  = removePeriod;
