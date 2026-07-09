/* admin.js — Admin Settings Logic */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {

  // Auth guard
  const session = await Auth.requireAuth(['admin']);
  hidePageLoader();
  initSidebar(session);

  // Load current settings
  const cfg = await Settings.get();
  
  // Elements
  const elSchoolName = document.getElementById('set-school-name');
  const elRadius     = document.getElementById('set-radius');
  const statusEl     = document.getElementById('location-status');
  const elLat        = document.getElementById('school-lat');
  const elLng        = document.getElementById('school-lng');

  // Populate UI
  if (elSchoolName) elSchoolName.value = cfg.schoolName || 'NIAT Schools';
  if (elRadius)     elRadius.value     = cfg.radius || 100;
  
  if (cfg.schoolLat && cfg.schoolLng) {
    statusEl.textContent = `✓ School set: ${cfg.schoolLat.toFixed(5)}, ${cfg.schoolLng.toFixed(5)}`;
    statusEl.className   = 'location-status success';
    if (elLat) elLat.value = cfg.schoolLat.toFixed(6);
    if (elLng) elLng.value = cfg.schoolLng.toFixed(6);
  }

  // 1. Save General Settings
  document.getElementById('save-general-settings')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.textContent = 'Saving...';
    try {
      await Settings.set({
        schoolName: elSchoolName.value.trim(),
        radius: parseInt(elRadius.value, 10) || 100
      });
      showToast('Settings saved successfully!', 'success');
    } catch (err) {
      showToast('Error saving settings.', 'error');
    }
    btn.textContent = 'Save General Settings';
  });

  // 2. Auto-detect GPS / IP Location
  document.getElementById('use-current-location')?.addEventListener('click', () => {
    statusEl.textContent = '📡 Getting location...';
    statusEl.className   = 'location-status';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        await Settings.set({ schoolLat: lat, schoolLng: lng });
        statusEl.textContent = `✓ GPS Saved: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        statusEl.className   = 'location-status success';
        if (elLat) elLat.value = lat.toFixed(6);
        if (elLng) elLng.value = lng.toFixed(6);
        showToast('School GPS location saved!', 'success');
      },
      async () => {
        statusEl.textContent = '❌ GPS denied. Trying IP location...';
        try {
          const res = await fetch('https://ipapi.co/json/');
          const data = await res.json();
          if (data.latitude && data.longitude) {
            await Settings.set({ schoolLat: data.latitude, schoolLng: data.longitude });
            statusEl.textContent = `✓ IP Location Saved: ${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`;
            statusEl.className   = 'location-status success';
            if (elLat) elLat.value = data.latitude.toFixed(6);
            if (elLng) elLng.value = data.longitude.toFixed(6);
            showToast('Approximate IP location saved!', 'success');
          } else throw new Error();
        } catch (err) {
          statusEl.textContent = '❌ Location access denied completely.';
          statusEl.className   = 'location-status error';
        }
      },
      { enableHighAccuracy: true }
    );
  });

  // 3. Save Location Manually
  document.getElementById('save-location-manual')?.addEventListener('click', async () => {
    const lat = parseFloat(elLat.value);
    const lng = parseFloat(elLng.value);
    if (!isNaN(lat) && !isNaN(lng)) {
      await Settings.set({ schoolLat: lat, schoolLng: lng });
      statusEl.textContent = `✓ Saved manually: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      statusEl.className   = 'location-status success';
      showToast('Manual location saved!', 'success');
    } else {
      showToast('Please enter valid coordinates', 'error');
    }
  });

  // =====================================================
  // 4. ANNOUNCEMENTS with Image Support
  // =====================================================
  const announceInput   = document.getElementById('admin-announce-input');
  const postBtn         = document.getElementById('admin-btn-post');
  const announceFeed    = document.getElementById('admin-announce-feed');
  const imgInput        = document.getElementById('admin-announce-img');
  const imgPreviewWrap  = document.getElementById('img-preview-wrap');
  const imgPreviewEl    = document.getElementById('img-preview');
  const progressWrap    = document.getElementById('upload-progress-wrap');
  const progressBar     = document.getElementById('upload-progress-bar');
  const progressLabel   = document.getElementById('upload-progress-label');

  // Show image preview when file selected
  imgInput?.addEventListener('change', () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      imgPreviewEl.src     = e.target.result;
      imgPreviewWrap.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // Real-time feed
  db.collection('announcements')
    .orderBy('createdAt', 'desc')
    .limit(30)
    .onSnapshot(snap => {
      if (!announceFeed) return;
      if (snap.empty) {
        announceFeed.innerHTML = '<p style="color:#64748b;font-size:0.85rem;">No announcements yet.</p>';
        return;
      }
      announceFeed.innerHTML = '';
      snap.docs.forEach(doc => {
        const d  = doc.data();
        const dt = d.createdAt
          ? new Date(d.createdAt.toDate ? d.createdAt.toDate() : d.createdAt).toLocaleString('en-IN')
          : '';
        const card = document.createElement('div');
        card.style.cssText = `
          background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);
          border-radius:12px;padding:16px 20px;
        `;
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
            <span style="font-size:0.78rem;color:#7c3aed;font-weight:700;letter-spacing:0.3px;">📢 ANNOUNCEMENT</span>
            <span style="font-size:0.75rem;color:#64748b;white-space:nowrap;">${dt}</span>
          </div>
          ${d.message ? `<p style="color:#f1f5f9;font-size:0.95rem;line-height:1.6;margin:0 0 12px;">${d.message}</p>` : ''}
          ${d.imageUrl ? `<img src="${d.imageUrl}" alt="Announcement" style="max-width:100%;border-radius:10px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.1);"/>` : ''}
          <button onclick="adminDeleteAnnouncement('${doc.id}')"
            style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#ef4444;
            padding:6px 16px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600;">
            🗑 Delete
          </button>
        `;
        announceFeed.appendChild(card);
      });
    });

  // Post button — with optional image upload
  postBtn?.addEventListener('click', async () => {
    const msg  = announceInput?.value.trim();
    const file = imgInput?.files[0];
    if (!msg && !file) { showToast('Type a message or attach an image!', 'error'); return; }

    postBtn.textContent = 'Posting...';
    postBtn.disabled    = true;

    try {
      let imageUrl = null;

      // Upload image if selected
      if (file && window.storage) {
        progressWrap.style.display = 'block';
        progressBar.style.width    = '0%';
        progressLabel.textContent  = 'Uploading image...';

        const ref      = window.storage.ref(`announcements/${Date.now()}_${file.name}`);
        const uploadTask = ref.put(file);

        await new Promise((resolve, reject) => {
          uploadTask.on('state_changed',
            snap => {
              const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              progressBar.style.width   = pct + '%';
              progressLabel.textContent = `Uploading... ${pct}%`;
            },
            err  => reject(err),
            async () => {
              imageUrl = await uploadTask.snapshot.ref.getDownloadURL();
              progressLabel.textContent = '✅ Upload complete!';
              resolve();
            }
          );
        });

        setTimeout(() => { progressWrap.style.display = 'none'; }, 1500);
      }

      await db.collection('announcements').add({
        message:   msg || '',
        imageUrl:  imageUrl || null,
        postedBy:  session.name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      announceInput.value             = '';
      imgInput.value                  = '';
      imgPreviewWrap.style.display    = 'none';
      imgPreviewEl.src                = '';
      showToast('Announcement posted to all teachers! ✅', 'success');
    } catch (e) {
      console.error(e);
      showToast('Error posting announcement: ' + e.message, 'error');
    }
    postBtn.textContent = '📤 Post Announcement';
    postBtn.disabled    = false;
  });

});

// Delete announcement
window.adminDeleteAnnouncement = async function(id) {
  if (!confirm('Delete this announcement?')) return;
  await db.collection('announcements').doc(id).delete();
  showToast('Announcement deleted.', 'info');
};

// Clear image preview
window.clearImgPreview = function() {
  const imgInput       = document.getElementById('admin-announce-img');
  const imgPreviewWrap = document.getElementById('img-preview-wrap');
  const imgPreviewEl   = document.getElementById('img-preview');
  if (imgInput) imgInput.value = '';
  if (imgPreviewEl) imgPreviewEl.src = '';
  if (imgPreviewWrap) imgPreviewWrap.style.display = 'none';
};
