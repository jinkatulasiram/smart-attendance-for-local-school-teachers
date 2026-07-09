/* reports.js — Firebase-powered reports & analytics */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {

  const session = await Auth.requireAuth(['admin', 'teacher']);
  hidePageLoader();
  initSidebar(session);

  const datePicker = document.getElementById('report-date');
  if (datePicker) datePicker.value = new Date().toISOString().slice(0, 10);

  await loadReports();

  datePicker?.addEventListener('change', loadReports);

  document.getElementById('rep-search')?.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll('#report-tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  document.getElementById('export-btn')?.addEventListener('click', exportCSV);
});

async function loadReports() {
  const [students, allAtt] = await Promise.all([
    UsersDB.getStudents(),
    AttDB.getAll()
  ]);

  const allDays = [...new Set(allAtt.map(r => r.date))];

  const stats = students.map(s => {
    const userAtt = allAtt.filter(r => r.userId === s.id);
    const present = userAtt.length;
    const absent  = Math.max(0, allDays.length - present);
    const pct     = allDays.length > 0
      ? Math.round((present / allDays.length) * 100) : 0;
    return { ...s, present, absent, pct, total: allDays.length };
  });

  // Summary cards
  const best = stats.length
    ? stats.reduce((a, b) => a.pct > b.pct ? a : b)
    : null;
  const avg  = stats.length
    ? Math.round(stats.reduce((a, b) => a + b.pct, 0) / stats.length) : 0;

  const el = id => document.getElementById(id);
  if (el('rp-best'))  el('rp-best').textContent  = best ? `${best.name} (${best.pct}%)` : '—';
  if (el('rp-warn'))  el('rp-warn').textContent  = stats.filter(s => s.pct < 75).length;
  if (el('rp-days'))  el('rp-days').textContent  = allDays.length;
  if (el('rp-avg'))   el('rp-avg').textContent   = avg + '%';

  renderReportTable(stats);
  loadBarChart(stats);
  loadTrendChart(allDays, students, allAtt);
}

function renderReportTable(stats) {
  const tbody = document.getElementById('report-tbody');
  if (!tbody) return;

  if (stats.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="empty-row">No students registered yet</td></tr>';
    return;
  }

  tbody.innerHTML = stats.map(s => {
    const pctColor = s.pct >= 75
      ? 'var(--green)' : s.pct >= 50 ? 'var(--amber)' : 'var(--red)';
    const badge    = s.pct >= 75
      ? '<span class="badge-good">Good</span>'
      : s.pct >= 50
      ? '<span class="badge-warn">At Risk</span>'
      : '<span class="badge-absent">Critical</span>';

    return `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td style="font-family:'Fira Code',monospace;font-size:0.8rem;">${s.rollNo || '—'}</td>
        <td>${s.className || '—'}</td>
        <td style="color:var(--green);font-weight:700;">${s.present}</td>
        <td style="color:var(--red);font-weight:700;">${s.absent}</td>
        <td>${s.total}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="pct-bar">
              <div class="pct-fill" style="width:${s.pct}%;background:${pctColor};"></div>
            </div>
            <span style="font-size:0.82rem;color:${pctColor};font-weight:700;min-width:36px;">
              ${s.pct}%
            </span>
          </div>
        </td>
        <td>${badge}</td>
      </tr>
    `;
  }).join('');
}

let barChart, trendChart;

function loadBarChart(stats) {
  const ctx = document.getElementById('barChart')?.getContext('2d');
  if (!ctx) return;

  const labels  = stats.map(s => s.name.split(' ')[0]);
  const data    = stats.map(s => s.pct);
  const colors  = data.map(p =>
    p >= 75 ? 'rgba(16,185,129,0.8)'
    : p >= 50 ? 'rgba(245,158,11,0.8)'
    : 'rgba(239,68,68,0.8)');
  const borders = data.map(p =>
    p >= 75 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444');

  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Attendance %',
        data, backgroundColor: colors, borderColor: borders,
        borderWidth: 1, borderRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y + '%' } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { min: 0, max: 100, ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
}

function loadTrendChart(allDates, students, allAtt) {
  const ctx = document.getElementById('trendChart')?.getContext('2d');
  if (!ctx) return;

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const total = students.length;
  const data  = days.map(d => {
    const present = allAtt.filter(r =>
      r.date === d && students.some(s => s.id === r.userId)).length;
    return total > 0 ? Math.round((present / total) * 100) : 0;
  });

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days.map(d => new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })),
      datasets: [{
        label: 'Attendance %',
        data,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.08)',
        borderWidth: 2, tension: 0.4, fill: true,
        pointRadius: 3, pointBackgroundColor: '#7c3aed'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } },
      scales: {
        x: { ticks: { color: '#94a3b8', maxRotation: 45, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { min: 0, max: 100, ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
}

async function exportCSV() {
  const [students, allAtt] = await Promise.all([
    UsersDB.getStudents(),
    AttDB.getAll()
  ]);
  const allDays = [...new Set(allAtt.map(r => r.date))];

  const rows = [['Name','Roll No','Class','Mobile','Email','Present','Absent','Total Days','Percentage']];
  students.forEach(s => {
    const present = allAtt.filter(r => r.userId === s.id).length;
    const absent  = Math.max(0, allDays.length - present);
    const pct     = allDays.length > 0 ? Math.round((present / allDays.length) * 100) : 0;
    rows.push([s.name, s.rollNo||'', s.className||'', s.mobile||'', s.email, present, absent, allDays.length, pct+'%']);
  });

  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `NIAT_Attendance_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported from cloud data! ☁️', 'success');
}
