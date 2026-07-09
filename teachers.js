/* students.js — Firebase-powered student management */
'use strict';

let allStudents = [];
let editingId   = null;
let session     = null;

document.addEventListener('DOMContentLoaded', async () => {

  session = await Auth.requireAuth(['admin', 'teacher']);
  hidePageLoader();
  initSidebar(session);

  if (session.role === 'teacher') {
    const addBtn = document.getElementById('add-student-btn');
    if (addBtn) addBtn.style.display = 'none';
  }

  await loadStudents();
  setupFilters();
  setupModal();
});

async function loadStudents() {
  const [students, todayRec, allAtt] = await Promise.all([
    UsersDB.getStudents(),
    AttDB.getToday(),
    AttDB.getAll()
  ]);

  allStudents = students;
  populateClassFilter(students);
  renderTable(students, todayRec, allAtt);
}

function renderTable(students, todayRec, allAtt) {
  const tbody = document.getElementById('students-tbody');
  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="empty-row">No students registered yet</td></tr>';
    return;
  }

  const allDays = [...new Set(allAtt.map(r => r.date))];

  tbody.innerHTML = students.map((s, i) => {
    const markedToday = todayRec.some(r => r.userId === s.id);
    const userAtt     = allAtt.filter(r => r.userId === s.id);
    const present     = userAtt.length;
    const pct         = allDays.length > 0
      ? Math.round((present / allDays.length) * 100) : 0;
    const pctColor    = pct >= 75
      ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${s.name}</strong></td>
        <td style="font-family:'Fira Code',monospace;font-size:0.8rem;">${s.rollNo || '—'}</td>
        <td>${s.className || '—'}</td>
        <td>${s.mobile || '—'}</td>
        <td style="font-size:0.82rem;">${s.email}</td>
        <td>${markedToday
          ? '<span class="badge-present">Present</span>'
          : '<span class="badge-absent">Absent</span>'}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="pct-bar">
              <div class="pct-fill" style="width:${pct}%;background:${pctColor};"></div>
            </div>
            <span style="font-size:0.8rem;color:${pctColor};font-weight:700;">${pct}%</span>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="action-btn view" onclick="viewStudent('${s.id}')">View</button>
            ${session.role === 'admin' ? `
            <button class="action-btn edit" onclick="openEditModal('${s.id}')">Edit</button>
            <button class="action-btn del"  onclick="deleteStudent('${s.id}')">Delete</button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function populateClassFilter(students) {
  const sel = document.getElementById('stu-class-filter');
  if (!sel) return;
  const classes = [...new Set(students.map(s => s.className).filter(Boolean))];
  sel.innerHTML = '<option value="">All Classes</option>' +
    classes.map(c => `<option value="${c}">${c}</option>`).join('');
}

function setupFilters() {
  const search = document.getElementById('stu-search');
  const cls    = document.getElementById('stu-class-filter');
  const status = document.getElementById('stu-status-filter');

  async function applyFilter() {
    const q    = search?.value.toLowerCase() || '';
    const cl   = cls?.value  || '';
    const st   = status?.value || '';
    const [todayRec, allAtt] = await Promise.all([AttDB.getToday(), AttDB.getAll()]);

    const filtered = allStudents.filter(s => {
      const matchQ  = !q || s.name.toLowerCase().includes(q)
        || (s.rollNo || '').toLowerCase().includes(q);
      const matchCl = !cl || s.className === cl;
      const marked  = todayRec.some(r => r.userId === s.id);
      const matchSt = !st
        || (st === 'present' ? marked : !marked);
      return matchQ && matchCl && matchSt;
    });
    renderTable(filtered, todayRec, allAtt);
  }

  search?.addEventListener('input',  applyFilter);
  cls?.addEventListener('change',    applyFilter);
  status?.addEventListener('change', applyFilter);
}

function setupModal() {
  document.getElementById('add-student-btn')
    ?.addEventListener('click', () => {
      editingId = null;
      document.getElementById('student-modal-title').textContent = 'Add Student';
      document.getElementById('save-student-btn').textContent    = 'Add Student';
      clearModalForm();
      document.getElementById('student-modal').style.display = 'flex';
    });

  document.getElementById('close-student-modal')
    ?.addEventListener('click', () => {
      document.getElementById('student-modal').style.display = 'none';
    });

  document.getElementById('close-view-modal')
    ?.addEventListener('click', () => {
      document.getElementById('view-student-modal').style.display = 'none';
    });

  document.getElementById('save-student-btn')
    ?.addEventListener('click', saveStudent);
}

function clearModalForm() {
  ['m-name','m-roll','m-class','m-mobile','m-email','m-pw'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errEl = document.getElementById('m-error');
  if (errEl) errEl.textContent = '';
}

async function saveStudent() {
  const name   = document.getElementById('m-name')?.value.trim();
  const roll   = document.getElementById('m-roll')?.value.trim();
  const cls    = document.getElementById('m-class')?.value.trim();
  const mobile = document.getElementById('m-mobile')?.value.trim();
  const email  = document.getElementById('m-email')?.value.trim();
  const pw     = document.getElementById('m-pw')?.value.trim();
  const errEl  = document.getElementById('m-error');
  const btn    = document.getElementById('save-student-btn');
  errEl.textContent = '';

  if (!name || !email || !mobile) {
    errEl.textContent = '❌ Name, email and mobile are required.'; return;
  }

  btn.textContent = 'Saving...';
  btn.disabled    = true;

  try {
    if (editingId) {
      // Update Firestore profile
      await UsersDB.update(editingId, {
        name, rollNo: roll, className: cls, mobile, email
      });
      showToast('Student updated! ☁️', 'success');
    } else {
      // Create Firebase Auth + Firestore profile
      if (!pw || pw.length < 6) {
        errEl.textContent = '❌ Password required (min 6 chars).';
        btn.textContent   = 'Add Student'; btn.disabled = false;
        return;
      }
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      await UsersDB.add({
        uid: cred.user.uid, name, rollNo: roll,
        className: cls, mobile, email, role: 'student'
      });
      showToast('Student added to cloud! ☁️', 'success');
    }

    document.getElementById('student-modal').style.display = 'none';
    await loadStudents();
  } catch (err) {
    let msg = err.message;
    if (err.code === 'auth/email-already-in-use')
      msg = 'Email already registered.';
    errEl.textContent = '❌ ' + msg;
  } finally {
    btn.textContent = editingId ? 'Save Changes' : 'Add Student';
    btn.disabled    = false;
  }
}

window.openEditModal = async function (id) {
  editingId = id;
  const s   = await UsersDB.getById(id);
  if (!s) return;
  document.getElementById('student-modal-title').textContent = 'Edit Student';
  document.getElementById('save-student-btn').textContent    = 'Save Changes';
  document.getElementById('m-name').value   = s.name        || '';
  document.getElementById('m-roll').value   = s.rollNo      || '';
  document.getElementById('m-class').value  = s.className   || '';
  document.getElementById('m-mobile').value = s.mobile      || '';
  document.getElementById('m-email').value  = s.email       || '';
  document.getElementById('m-pw').value     = '';
  document.getElementById('m-error').textContent = '';
  document.getElementById('student-modal').style.display = 'flex';
};

window.deleteStudent = async function (id) {
  if (!confirm('Delete this student and all their attendance records?')) return;
  try {
    await UsersDB.delete(id);
    showToast('Student deleted from cloud.', 'error');
    await loadStudents();
  } catch (err) {
    showToast('Error deleting student: ' + err.message, 'error');
  }
};

window.viewStudent = async function (id) {
  const [s, allAtt] = await Promise.all([
    UsersDB.getById(id),
    AttDB.getAll()
  ]);
  if (!s) return;

  const allDays = [...new Set(allAtt.map(r => r.date))];
  const userAtt = allAtt.filter(r => r.userId === id);
  const present = userAtt.length;
  const absent  = Math.max(0, allDays.length - present);
  const pct     = allDays.length > 0 ? Math.round((present / allDays.length) * 100) : 0;
  const pctColor = pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
  const recent   = [...userAtt].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);

  document.getElementById('view-student-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div class="input-group"><label>Full Name</label>
        <div style="padding:10px;background:var(--bg2);border-radius:8px;">${s.name}</div></div>
      <div class="input-group"><label>Roll Number</label>
        <div style="padding:10px;background:var(--bg2);border-radius:8px;font-family:'Fira Code',monospace;">${s.rollNo || '—'}</div></div>
      <div class="input-group"><label>Class</label>
        <div style="padding:10px;background:var(--bg2);border-radius:8px;">${s.className || '—'}</div></div>
      <div class="input-group"><label>Mobile</label>
        <div style="padding:10px;background:var(--bg2);border-radius:8px;">${s.mobile || '—'}</div></div>
      <div class="input-group" style="grid-column:span 2"><label>Email</label>
        <div style="padding:10px;background:var(--bg2);border-radius:8px;">${s.email}</div></div>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:20px;">
      <div style="flex:1;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:1.8rem;font-weight:800;color:var(--green);">${present}</div>
        <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Present</div>
      </div>
      <div style="flex:1;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:1.8rem;font-weight:800;color:var(--red);">${absent}</div>
        <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Absent</div>
      </div>
      <div style="flex:1;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:1.8rem;font-weight:800;color:${pctColor};">${pct}%</div>
        <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Overall</div>
      </div>
    </div>
    <h4 style="margin-bottom:10px;font-size:0.9rem;color:var(--muted);">Recent Attendance</h4>
    ${recent.length > 0 ? recent.map(r => `
      <div class="hist-row" style="margin-bottom:6px;">
        <span class="hist-date">${r.date}</span>
        <span class="badge-present">Present</span>
        <span class="hist-time">${r.time}</span>
      </div>`).join('') : '<p style="color:var(--muted);font-size:0.85rem;">No records yet</p>'}
  `;
  document.getElementById('view-student-modal').style.display = 'flex';
};
