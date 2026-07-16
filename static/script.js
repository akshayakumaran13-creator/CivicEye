/* ============================================================
   CivicEye — Main Frontend Script
   Features: i18n, GPS+Geocoding, Map, Alerts, Dashboard, PDF
   ============================================================ */

// ---- Global State ----
let currentLang = 'en';
let translations = {};
let currentMap = null;
let currentTileLayer = null;
let alertMarkers = [];
let selectedFile = null;
let lastResult = null;
let userLat = null;
let userLng = null;
let currentAlertFilter = 'Active';

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('civiceye-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-icon').textContent = saved === 'dark' ? '🌙' : '☀️';
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('civiceye-theme', next);
  document.getElementById('theme-icon').textContent = next === 'dark' ? '🌙' : '☀️';
  if (currentMap) {
    currentMap.invalidateSize();
    if (currentTileLayer) {
      currentMap.removeLayer(currentTileLayer);
    }
    const isDark = next === 'dark';
    const tileUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    currentTileLayer = L.tileLayer(tileUrl, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(currentMap);
  }
}

// ---- i18n ----
async function loadLang(code) {
  try {
    const res = await fetch('/lang/' + code);
    translations = await res.json();
    applyTranslations();
  } catch (e) {
    console.error('Lang load error:', e);
  }
}
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[key]) el.textContent = translations[key];
  });
}
function t(key) { return translations[key] || key; }
function changeLang(code) {
  currentLang = code;
  loadLang(code);
  loadGuidelines();
}

// ---- Tab Navigation ----
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'map') initMap();
  if (name === 'dashboard') loadDashboard();
  if (name === 'alerts') loadAlerts(currentAlertFilter);
  if (name === 'chatbot') loadChatApiKeyLarge();
  
  // Hide small floating bubble when on dedicated AI Assistant tab
  const bubble = document.getElementById('chat-widget');
  if (bubble) {
    bubble.style.display = name === 'chatbot' ? 'none' : 'block';
  }
}

// ---- File Handling ----
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) setFile(file);
}
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
}
function setFile(file) {
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('preview-img').src = ev.target.result;
    document.getElementById('preview-name').textContent = file.name;
    document.getElementById('dz-preview').style.display = 'block';
    document.getElementById('dz-icon').style.display = 'none';
    document.getElementById('dz-text').style.display = 'none';
    document.querySelector('.dropzone-hint').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ---- GPS + Reverse Geocoding ----
async function getGPS() {
  const btn = document.getElementById('btn-gps');
  btn.textContent = '📡 Detecting...';
  btn.disabled = true;
  if (!navigator.geolocation) {
    showToast('Geolocation not supported by your browser');
    btn.textContent = '📍 Use GPS Location';
    btn.disabled = false;
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    userLat = pos.coords.latitude.toFixed(6);
    userLng = pos.coords.longitude.toFixed(6);
    document.getElementById('inp-lat').value = userLat;
    document.getElementById('inp-lng').value = userLng;
    btn.textContent = '✅ GPS Acquired';
    btn.disabled = false;
    // Reverse geocode using Nominatim (free, no API key)
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${userLat}&lon=${userLng}&format=json`, {
        headers: { 'Accept-Language': currentLang }
      });
      const data = await res.json();
      const place = data.display_name || 'Unknown Location';
      document.getElementById('inp-place').value = place.split(',').slice(0, 3).join(', ');
      showToast('📍 Location acquired!');
    } catch (e) {
      document.getElementById('inp-place').value = `${userLat}, ${userLng}`;
    }
    loadNearbyPlaces(userLat, userLng);
  }, (err) => {
    showToast('Could not get location: ' + err.message);
    btn.textContent = '📍 Use GPS Location';
    btn.disabled = false;
  }, { timeout: 15000, enableHighAccuracy: true });
}

// ---- Nearby Places (Overpass API via OSM) ----
async function loadNearbyPlaces(lat, lng) {
  // Hospitals
  const hList = document.getElementById('hospitals-list');
  const szList = document.getElementById('safezones-list');
  hList.innerHTML = '<p class="dim">Searching...</p>';
  szList.innerHTML = '<p class="dim">Searching...</p>';
  const radius = 3000; // 3km
  const query = `[out:json][timeout:15];
    (
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      node["amenity"="clinic"](around:${radius},${lat},${lng});
      node["amenity"="doctors"](around:${radius},${lat},${lng});
    );out body 5;
    (
      node["amenity"="police"](around:${radius},${lat},${lng});
      node["amenity"="fire_station"](around:${radius},${lat},${lng});
      node["emergency"="assembly_point"](around:${radius},${lat},${lng});
    );out body 5;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `[out:json][timeout:15];
(node["amenity"~"hospital|clinic|doctors"](around:${radius},${lat},${lng}););out body 5;`,
    });
    const data = await res.json();
    renderPlaces(hList, data.elements, '🏥');
  } catch {
    hList.innerHTML = '<p class="dim">Could not load hospitals</p>';
  }
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `[out:json][timeout:15];
(node["amenity"~"police|fire_station"](around:${radius},${lat},${lng});node["emergency"="assembly_point"](around:${radius},${lat},${lng}););out body 5;`,
    });
    const data = await res.json();
    renderPlaces(szList, data.elements, '🛡️');
  } catch {
    szList.innerHTML = '<p class="dim">Could not load safe zones</p>';
  }
}
function renderPlaces(container, elements, icon) {
  if (!elements || elements.length === 0) {
    container.innerHTML = '<p class="dim">None found within 3km</p>';
    return;
  }
  container.innerHTML = '';
  elements.slice(0, 5).forEach(el => {
    const name = el.tags && (el.tags.name || el.tags['name:en'] || el.tags.amenity) || 'Unknown';
    const type = el.tags && el.tags.amenity || '';
    const div = document.createElement('div');
    div.className = 'place-item';
    div.innerHTML = `<b>${icon} ${name}</b><span>${type.replace('_', ' ')}</span>`;
    container.appendChild(div);
  });
}

// ---- Map ----
function initMap() {
  if (currentMap) {
    currentMap.invalidateSize();
    refreshMapMarkers();
    return;
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  currentMap = L.map('main-map', { zoomControl: true }).setView([20.5937, 78.9629], 5);
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  currentTileLayer = L.tileLayer(tileUrl, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(currentMap);
  if (userLat && userLng) {
    currentMap.setView([parseFloat(userLat), parseFloat(userLng)], 13);
  }
  refreshMapMarkers();
}

function severityColor(sev) {
  if (sev === 'High') return '#ff6b8a';
  if (sev === 'Medium') return '#ffd580';
  return '#80e8b0';
}

function catIcon(cat) {
  const icons = {
    'Pothole': '🕳️', 'Garbage': '🗑️', 'Streetlight Issue': '💡',
    'Flooding': '🌊', 'Open Manhole': '⚠️', 'Fallen Tree': '🌳', 'Other': '📍'
  };
  return icons[cat] || '📍';
}

async function refreshMapMarkers() {
  if (!currentMap) return;
  // Remove old markers
  alertMarkers.forEach(m => currentMap.removeLayer(m));
  alertMarkers = [];
  try {
    const res = await fetch('/reports-list');
    const reports = await res.json();
    reports.forEach(r => {
      const lat = parseFloat(r.latitude);
      const lng = parseFloat(r.longitude);
      if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
      const color = r.status === 'Resolved' ? '#aaaaaa' : severityColor(r.severity);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 0 0 4px ${color}33;border:2px solid white;">${catIcon(r.category)}</div>`,
        iconSize: [36, 36], iconAnchor: [18, 18]
      });
      const marker = L.marker([lat, lng], { icon }).addTo(currentMap);
      
      const isResolved = r.status === 'Resolved';
      const flagBtnHtml = isResolved 
        ? '' 
        : `<button class="btn-flag-popup" onclick="flagReport(${r.id})" style="background:var(--accent2);border:none;color:#1e293b;padding:4px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;cursor:pointer;margin-top:6px;display:inline-flex;align-items:center;gap:4px;">🚩 Flag Urgent (${r.flags_count || 1})</button>`;
        
      marker.bindPopup(`<div class="popup-inner"><h4>${catIcon(r.category)} ${r.category}</h4><p>📍 ${r.place_name || 'Unknown'}</p><p>⚠️ Severity: <b>${r.severity}</b></p><p>🕑 ${r.timestamp}</p><p>Status: <b>${r.status}</b></p>${flagBtnHtml}</div>`);
      alertMarkers.push(marker);
    });
    if (alertMarkers.length > 0 && !userLat) {
      const group = new L.featureGroup(alertMarkers);
      currentMap.fitBounds(group.getBounds().pad(0.2));
    }
  } catch(e) { console.error('Map refresh error:', e); }
}

// ---- Report Submission ----
async function submitReport() {
  if (!selectedFile) {
    showToast('⚠️ ' + t('error_upload'));
    return;
  }
  const spinner = document.getElementById('submit-spinner');
  const btn = document.getElementById('btn-submit');
  spinner.style.display = 'inline-block';
  btn.disabled = true;
  const fd = new FormData();
  fd.append('image', selectedFile);
  fd.append('latitude', document.getElementById('inp-lat').value || '');
  fd.append('longitude', document.getElementById('inp-lng').value || '');
  fd.append('place_name', document.getElementById('inp-place').value || 'Unknown Location');
  fd.append('language', currentLang);
  try {
    const res = await fetch('/report', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    lastResult = data;
    showResult(data);
    loadStats();
    showToast('✅ ' + t('success_report'));
    refreshMapMarkers();
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  } finally {
    spinner.style.display = 'none';
    btn.disabled = false;
  }
}

function showResult(data) {
  const card = document.getElementById('result-card');
  card.style.display = 'block';
  // Badge
  const badge = document.getElementById('result-severity-badge');
  badge.className = 'result-badge ' + data.severity;
  badge.textContent = data.severity;
  document.getElementById('result-cat-label').textContent = catIcon(data.category) + ' ' + data.category;
  document.getElementById('result-id-label').textContent = 'Report #' + data.id;
  document.getElementById('result-place-val').textContent = data.place_name || 'Unknown';
  document.getElementById('result-authority-val').textContent = data.authority || '';
  // Safety
  const safetyUl = document.getElementById('result-safety-list');
  safetyUl.innerHTML = (data.safety_tips || []).map(tip => `<li>${tip}</li>`).join('');
  // First Aid
  const aidUl = document.getElementById('result-firstaid-list');
  aidUl.innerHTML = (data.first_aid || []).map(tip => `<li>${tip}</li>`).join('');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Stats ----
async function loadStats() {
  try {
    const res = await fetch('/stats');
    const data = await res.json();
    animateNum('num-total', data.total || 0);
    animateNum('num-active', data.active || 0);
    animateNum('num-resolved', data.resolved || 0);
    animateNum('num-high', data.severity && data.severity.High || 0);
    
    // Update Dynamic Broadcast Banner
    const banner = document.getElementById('alert-banner');
    const bannerText = document.getElementById('alert-banner-text');
    if (banner && bannerText) {
      if (data.active > 0) {
        const reportsRes = await fetch('/active-alerts');
        const activeReports = await reportsRes.json();
        
        let message = "Alert: Active community hazards detected nearby. Exercise caution!";
        if (activeReports.length > 0) {
          const alertsList = activeReports.slice(0, 3).map(r => `${catIcon(r.category)} ${r.category} at ${r.place_name || 'Unknown Location'}`);
          message = `⚠️ ACTIVE WARNINGS: ${alertsList.join(' | ')}. Please exercise caution in these hazard sectors!`;
        }
        
        bannerText.textContent = message;
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    }
  } catch(e) { console.error('Stats error:', e); }
}

function animateNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const dur = 800;
  const step = (ts) => {
    if (!step.startTime) step.startTime = ts;
    const prog = Math.min((ts - step.startTime) / dur, 1);
    el.textContent = Math.round(start + (target - start) * prog);
    if (prog < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- Dashboard ----
async function loadDashboard() {
  try {
    const [statsRes, reportsRes] = await Promise.all([
      fetch('/stats'), fetch('/reports-list')
    ]);
    const stats = await statsRes.json();
    const reports = await reportsRes.json();
    renderCatChart(stats.category || {});
    renderSevRing(stats.severity || {}, stats.total || 0);
    renderDashTable(reports);
  } catch(e) { console.error('Dashboard error:', e); }
}

function renderCatChart(catData) {
  const area = document.getElementById('cat-chart');
  if (!area) return;
  const entries = Object.entries(catData).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(e => e[1]), 1);
  const colors = ['#a78bfa','#7dd3fc','#86efac','#fcd34d','#fb7185','#f9a8d4','#c4b5fd'];
  area.innerHTML = entries.map(([cat, cnt], i) => `
    <div class="chart-bar-item">
      <div class="chart-label">${catIcon(cat)} ${cat}</div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:0%;background:${colors[i % colors.length]}" data-w="${(cnt / max * 100).toFixed(1)}%"></div>
      </div>
      <div class="chart-count">${cnt}</div>
    </div>
  `).join('');
  // Animate bars
  setTimeout(() => {
    area.querySelectorAll('.chart-bar').forEach(bar => {
      bar.style.width = bar.getAttribute('data-w');
    });
  }, 100);
}

function renderSevRing(sevData, total) {
  const high = sevData.High || 0;
  const med = sevData.Medium || 0;
  const low = sevData.Low || 0;
  const circumference = 2 * Math.PI * 50;
  const tot = high + med + low || 1;
  document.getElementById('ring-high').style.strokeDasharray = `${(high/tot)*circumference} ${circumference}`;
  document.getElementById('ring-med').style.strokeDasharray = `${(med/tot)*circumference} ${circumference}`;
  document.getElementById('ring-low').style.strokeDasharray = `${(low/tot)*circumference} ${circumference}`;
  // Offset chaining for stacking segments
  let offset = 0;
  const highEl = document.getElementById('ring-high');
  const medEl = document.getElementById('ring-med');
  const lowEl = document.getElementById('ring-low');
  const base = -(circumference * 0.25);
  highEl.style.strokeDashoffset = base;
  medEl.style.strokeDashoffset = base - (high / tot) * circumference;
  lowEl.style.strokeDashoffset = base - ((high + med) / tot) * circumference;
  document.getElementById('ring-center-text').textContent = total;
  document.getElementById('leg-high').textContent = high;
  document.getElementById('leg-med').textContent = med;
  document.getElementById('leg-low').textContent = low;
}

function renderDashTable(reports) {
  const tbody = document.getElementById('dash-tbody');
  if (!tbody) return;
  if (!reports.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px">No reports yet</td></tr>';
    return;
  }
  tbody.innerHTML = reports.slice(0, 20).map(r => `
    <tr>
      <td>#${r.id}</td>
      <td>${catIcon(r.category)} ${r.category}</td>
      <td><span class="sev-chip ${r.severity}">${r.severity}</span></td>
      <td>${r.place_name || '—'}</td>
      <td>${r.timestamp ? r.timestamp.split(' ')[0] : '—'}</td>
      <td><span class="status-chip ${r.status}">${r.status}</span></td>
      <td>${r.status === 'Active' ? `<button class="btn-resolve-sm" onclick="resolveReport(${r.id})">✅ Resolve</button>` : '—'}</td>
    </tr>
  `).join('');
}

// ---- Alerts Tab ----
async function flagReport(id) {
  try {
    const res = await fetch('/flag-report/' + id, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('🚩 Report marked as urgent!');
      loadStats();
      loadDashboard();
      loadAlerts(currentAlertFilter);
      refreshMapMarkers();
    }
  } catch(e) { showToast('Error flagging report'); }
}

async function loadAlerts(status) {
  currentAlertFilter = status;
  const url = '/reports-list';
  const grid = document.getElementById('alerts-grid');
  const watchlistGrid = document.getElementById('watchlist-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="dim" style="grid-column:1/-1;padding:20px;text-align:center">Loading alerts...</p>';
  try {
    const res = await fetch(url);
    const reports = await res.json();
    
    // Render Watchlist (Top 3 Unresolved Active Reports sorted by flags_count desc)
    if (watchlistGrid) {
      const activeUnresolved = reports.filter(r => r.status === 'Active').sort((a, b) => (b.flags_count || 1) - (a.flags_count || 1));
      const topFlagged = activeUnresolved.slice(0, 3);
      
      if (topFlagged.length === 0) {
        watchlistGrid.innerHTML = `
          <div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-dim); background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--radius-sm);">
            No critical active hazards flagged yet. Keep your neighborhood safe by flagging active hazards on the map or feed!
          </div>
        `;
      } else {
        watchlistGrid.innerHTML = topFlagged.map(r => `
          <div class="alert-card ${r.severity}" style="border-color:var(--danger); box-shadow:0 0 16px rgba(251,113,133,0.12);">
            <div class="alert-card-top">
              <div class="alert-cat-icon">${catIcon(r.category)}</div>
              <div>
                <div class="alert-cat-name">${r.category}</div>
                <span class="sev-chip ${r.severity}">${r.severity}</span>
              </div>
            </div>
            <div class="alert-place">📍 ${r.place_name || '—'}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; font-size:0.75rem; color:var(--text-sub);">
              <span>🚩 Votes: <b>${r.flags_count || 1}</b></span>
              <span class="status-chip Active" style="animation: pulse-glow 1.5s infinite;">⚠️ Watchlist</span>
            </div>
            <div style="margin-top:10px; display:flex; gap:8px;">
              <button class="btn-resolve-sm" style="flex:1; text-align:center;" onclick="resolveReport(${r.id})">✅ Resolve</button>
              <button class="btn-resolve-sm" style="background:var(--accent2); color:#1e293b; border-color:var(--accent2); flex:1; text-align:center;" onclick="flagReport(${r.id})">🚩 Flag Urgent</button>
            </div>
          </div>
        `).join('');
      }
    }

    // Filter main grid reports list
    const filteredReports = status ? reports.filter(r => r.status === status) : reports;
    
    if (!filteredReports.length) {
      grid.innerHTML = `<p class="dim" style="grid-column:1/-1;padding:20px;text-align:center">${t('no_alerts')}</p>`;
      return;
    }
    
    grid.innerHTML = filteredReports.map(r => `
      <div class="alert-card ${r.severity}">
        <div class="alert-card-top">
          <div class="alert-cat-icon">${catIcon(r.category)}</div>
          <div>
            <div class="alert-cat-name">${r.category}</div>
            <span class="sev-chip ${r.severity}">${r.severity}</span>
          </div>
        </div>
        <div class="alert-place">📍 ${r.place_name || '—'}</div>
        <div class="alert-time">🕑 ${r.timestamp || ''}</div>
        <div style="margin-top:8px; font-size:0.75rem; color:var(--text-sub);">🚩 Flags: <b>${r.flags_count || 1}</b></div>
        <div class="alert-footer">
          <span class="status-chip ${r.status}">${r.status}</span>
          ${r.status === 'Active' ? `
            <div style="display:flex; gap:6px;">
              <button class="btn-resolve-sm" onclick="resolveReport(${r.id})">✅ Resolve</button>
              <button class="btn-resolve-sm" style="background:var(--surface); border-color:var(--surface-border); color:var(--text-sub);" onclick="flagReport(${r.id})">🚩 Flag</button>
            </div>
          ` : '<span class="alert-resolved-badge">✅ Resolved</span>'}
        </div>
      </div>
    `).join('');
  } catch(e) {
    console.error(e);
    grid.innerHTML = '<p class="dim" style="text-align:center;padding:20px">Error loading alerts</p>';
  }
}

function filterAlerts(status, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadAlerts(status);
}

// ---- Resolve Report ----
async function resolveReport(id) {
  try {
    const res = await fetch('/resolve/' + id, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Report #' + id + ' marked as Resolved');
      loadStats();
      loadDashboard();
      loadAlerts(currentAlertFilter);
      refreshMapMarkers();
    }
  } catch(e) { showToast('Error resolving report'); }
}

// ---- PDF Report ----
function downloadReport() {
  if (!lastResult) return;
  const r = lastResult;
  const content = `CIVICEYE CIVIC ISSUE REPORT
================================
Report ID   : #${r.id}
Date        : ${new Date().toLocaleString()}
--------------------------------
ISSUE DETAILS
Category    : ${r.category}
Severity    : ${r.severity}
Location    : ${r.place_name || 'Unknown'}
Coordinates : ${r.latitude || '—'}, ${r.longitude || '—'}
Authority   : ${r.authority}
Image File  : ${r.filename}
--------------------------------
SAFETY TIPS
${(r.safety_tips || []).map((t, i) => `${i+1}. ${t}`).join('\n')}
--------------------------------
FIRST AID INSTRUCTIONS
${(r.first_aid || []).map((t, i) => `${i+1}. ${t}`).join('\n')}
--------------------------------
This report was generated by CivicEye
Powered by ML Image Analysis + OpenStreetMap
================================`;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CivicEye_Report_${r.id}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📄 Report downloaded!');
}

// ---- Toast ----
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ---- Snowflake/Seasonal Particle Animation ----
let particleCanvas = null;
let particleCtx = null;
let particles = [];
const maxParticles = 65;
let mouse = { x: null, y: null, radius: 150 };

function initParticles() {
  particleCanvas = document.getElementById('bg-canvas');
  if (!particleCanvas) return;
  particleCtx = particleCanvas.getContext('2d');
  
  resizeParticleCanvas();
  window.addEventListener('resize', resizeParticleCanvas);
  
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  
  window.addEventListener('mouseleave', () => {
    mouse.x = null;
    mouse.y = null;
  });
  
  particles = [];
  for (let i = 0; i < maxParticles; i++) {
    particles.push(createParticle(true));
  }
  
  animateParticles();
}

function resizeParticleCanvas() {
  if (!particleCanvas) return;
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
}

function createParticle(randomY = false) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    x: Math.random() * window.innerWidth,
    y: randomY ? Math.random() * window.innerHeight : -10,
    size: Math.random() * 3 + 1,
    speedY: Math.random() * 1 + 0.5,
    speedX: Math.random() * 0.5 - 0.25,
    opacity: Math.random() * 0.35 + 0.55,
    angle: Math.random() * Math.PI * 2,
    spin: Math.random() * 0.02 - 0.01
  };
}

function drawSnowflake(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, size * 0.15);
  ctx.beginPath();
  // Draw 6 radiating branches
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const endX = x + Math.cos(angle) * size;
    const endY = y + Math.sin(angle) * size;
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    
    // Draw minor sub-branches
    const subLength = size * 0.35;
    const branchAngle1 = angle - Math.PI / 4;
    const branchAngle2 = angle + Math.PI / 4;
    const subX = x + Math.cos(angle) * (size * 0.55);
    const subY = y + Math.sin(angle) * (size * 0.55);
    
    ctx.moveTo(subX, subY);
    ctx.lineTo(subX + Math.cos(branchAngle1) * subLength, subY + Math.sin(branchAngle1) * subLength);
    ctx.moveTo(subX, subY);
    ctx.lineTo(subX + Math.cos(branchAngle2) * subLength, subY + Math.sin(branchAngle2) * subLength);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSparkleStar(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x, y, x + size, y);
  ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y);
  ctx.quadraticCurveTo(x, y, x, y - size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawParticleConnection(ctx, x1, y1, x2, y2, alpha, isDark) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  const midX = x1 + dx * 0.5;
  const midY = y1 + dy * 0.5;
  const size = 3;
  const color = isDark ? `rgba(255, 255, 255, ${alpha * 2.8})` : `rgba(74, 58, 163, ${alpha * 2.5})`;
  
  if (isDark) {
    drawSparkleStar(ctx, midX, midY, size, color);
  } else {
    drawSnowflake(ctx, midX, midY, size, color);
  }

  // Draw stardust trail
  const step = 15;
  const count = Math.floor(dist / step);
  ctx.save();
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(px, py, 1.0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function spawnSparkles(x, y) {
  const count = 22;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 1.5;
    particles.push({
      x: x,
      y: y,
      size: Math.random() * 2 + 1,
      speedY: Math.sin(angle) * speed - 1.2, // initial upward push
      speedX: Math.cos(angle) * speed,
      opacity: 1.0,
      angle: Math.random() * Math.PI * 2,
      spin: Math.random() * 0.08 - 0.04,
      isSparkle: true,
      color: '#ffffff',
      life: 1.0,
      decay: Math.random() * 0.02 + 0.015
    });
  }
}

// Sparkle click trigger for landing page
window.addEventListener('click', (e) => {
  const overlay = document.getElementById('welcome-overlay');
  if (overlay && overlay.style.display !== 'none') {
    spawnSparkles(e.clientX, e.clientY);
  }
});

function animateParticles() {
  if (!particleCanvas || !particleCtx) return;
  
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
  
  // Constant falling sparkles rain if welcome overlay is open
  const overlay = document.getElementById('welcome-overlay');
  if (overlay && overlay.style.display !== 'none') {
    if (Math.random() < 0.14) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: -10,
        size: Math.random() * 2.5 + 1.2,
        speedY: Math.random() * 0.8 + 0.4, // gentle downward speed, like snowflakes
        speedX: Math.random() * 0.4 - 0.2, // gentle horizontal sway
        opacity: Math.random() * 0.4 + 0.6,
        angle: Math.random() * Math.PI * 2,
        spin: Math.random() * 0.04 - 0.02,
        isSparkle: true,
        color: '#ffffff',
        life: 1.0,
        decay: Math.random() * 0.005 + 0.003 // slower decay so they drift further down
      });
    }
  }
  
  // Draw connection lines
  const maxDistance = 90;
  for (let i = 0; i < particles.length; i++) {
    if (particles[i].isSparkle) continue;
    for (let j = i + 1; j < particles.length; j++) {
      if (particles[j].isSparkle) continue;
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDistance) {
        const alpha = (1 - dist / maxDistance) * 0.12;
        drawParticleConnection(particleCtx, particles[i].x, particles[i].y, particles[j].x, particles[j].y, alpha, isDark);
      }
    }
  }
  
  // Draw connection lines to mouse cursor
  if (mouse.x !== null && mouse.y !== null) {
    for (let i = 0; i < particles.length; i++) {
      if (particles[i].isSparkle) continue;
      const dx = particles[i].x - mouse.x;
      const dy = particles[i].y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouse.radius) {
        const alpha = (1 - dist / mouse.radius) * 0.22;
        drawParticleConnection(particleCtx, particles[i].x, particles[i].y, mouse.x, mouse.y, alpha, isDark);
      }
    }
  }
  
  // Draw particles
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    let baseColor = isDark ? `rgba(255, 255, 255, ${p.opacity})` : `rgba(74, 58, 163, ${p.opacity * 0.9})`;
    
    // Assign random color if it is a sparkle
    if (p.isSparkle && p.color) {
      baseColor = hexToRgba(p.color, p.opacity);
    }
    
    if (isDark) {
      // Dark Mode: Draw sparkle stars
      if (p.size > 2.2) {
        drawSparkleStar(particleCtx, p.x, p.y, p.size * 2.5, baseColor);
      } else {
        particleCtx.beginPath();
        particleCtx.fillStyle = baseColor;
        particleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        particleCtx.fill();
      }
    } else {
      // Light Mode: Draw snowflakes
      if (p.size > 2.2) {
        drawSnowflake(particleCtx, p.x, p.y, p.size * 2, baseColor);
      } else {
        particleCtx.beginPath();
        particleCtx.fillStyle = baseColor;
        particleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        particleCtx.fill();
      }
    }
    
    if (p.isSparkle) {
      p.y += p.speedY;
      p.x += p.speedX;
      p.speedY += 0.06; // gravity drift
      p.opacity -= p.decay;
      p.life -= p.decay;
      
      if (p.life <= 0) {
        particles.splice(i, 1);
        i--;
      }
    } else {
      p.y += p.speedY;
      p.x += p.speedX + Math.sin(p.angle) * 0.3;
      p.angle += p.spin;
      
      if (p.y > window.innerHeight + 10 || p.x > window.innerWidth + 10 || p.x < -10) {
        particles[i] = createParticle(false);
      }
    }
  }
  
  requestAnimationFrame(animateParticles);
}

// ---- Guidebook Logic ----
let guidebookData = {};
async function loadGuidelines() {
  try {
    const res = await fetch('/guidelines?lang=' + currentLang);
    guidebookData = await res.json();
    renderGuidebook();
  } catch (e) {
    console.error('Error loading guidelines:', e);
  }
}

function renderGuidebook() {
  const tabsContainer = document.getElementById('guidebook-tabs');
  const contentContainer = document.getElementById('guidebook-content');
  if (!tabsContainer || !contentContainer) return;
  
  const categories = Object.keys(guidebookData).filter(c => c !== 'Other');
  if (categories.length === 0) return;
  
  tabsContainer.innerHTML = categories.map((cat, i) => `
    <button class="guide-tab-btn ${i === 0 ? 'active' : ''}" onclick="showGuideTab('${cat}', this)">
      ${catIcon(cat)} ${cat}
    </button>
  `).join('');
  
  selectGuideTab(categories[0]);
}

function showGuideTab(cat, btn) {
  document.querySelectorAll('.guide-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectGuideTab(cat);
}

function selectGuideTab(cat) {
  const container = document.getElementById('guidebook-content');
  if (!container || !guidebookData[cat]) return;
  const data = guidebookData[cat];
  
  container.innerHTML = `
    <div class="guide-info-row">
      <div class="guide-col">
        <h3>🛡️ ${t('result_safety')}</h3>
        <ul>
          ${data.safety.map(tip => `<li>${tip}</li>`).join('')}
        </ul>
      </div>
      <div class="guide-col">
        <h3>🚑 ${t('result_firstaid')}</h3>
        <ul>
          ${data.first_aid.map(tip => `<li>${tip}</li>`).join('')}
        </ul>
      </div>
    </div>
    <div class="guide-footer-row">
      <span>🏛️ <b>${t('result_authority')}:</b> ${data.authority}</span>
    </div>
  `;
}

// ---- AI Chatbot Logic ----
let chatHistory = [];

function toggleChat() {
  const windowEl = document.getElementById('chat-window');
  if (!windowEl) return;
  
  if (windowEl.style.display === 'none') {
    windowEl.style.display = 'flex';
    document.getElementById('chat-input').focus();
    loadChatApiKey();
  } else {
    windowEl.style.display = 'none';
  }
}

function toggleChatSettings() {
  const drawer = document.getElementById('chat-settings-drawer');
  if (!drawer) return;
  drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
}

function saveChatApiKey(val) {
  localStorage.setItem('groq_api_key', val.trim());
}

function loadChatApiKey() {
  const key = localStorage.getItem('groq_api_key') || '';
  const input = document.getElementById('chat-api-key');
  if (input) input.value = key;
}

function sendChatChip(text) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    handleChatSubmit(new Event('submit'));
  }
}

async function handleChatSubmit(e) {
  if (e) e.preventDefault();
  
  const input = document.getElementById('chat-input');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  input.value = '';
  
  // Append User message to UI
  appendChatMessage(text, 'user');
  
  // Track history
  chatHistory.push({ role: 'user', content: text });
  if (chatHistory.length > 10) chatHistory.shift();
  
  // Show typing indicator
  const typingId = showChatTypingIndicator();
  
  try {
    const userKey = localStorage.getItem('groq_api_key') || '';
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        api_key: userKey,
        history: chatHistory,
        language: currentLang || 'en'
      })
    });
    
    // Remove typing indicator
    removeChatTypingIndicator(typingId);
    
    const data = await res.json();
    if (res.ok && data.reply) {
      appendChatMessage(data.reply, 'assistant');
      chatHistory.push({ role: 'assistant', content: data.reply });
      if (chatHistory.length > 10) chatHistory.shift();
    } else {
      appendChatMessage(data.error || 'Failed to get a response.', 'error');
    }
  } catch (err) {
    removeChatTypingIndicator(typingId);
    appendChatMessage('Network error occurred. Please check connection.', 'error');
    console.error('Chat error:', err);
  }
}

function appendChatMessage(text, sender) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${sender}`;
  
  // Basic markdown rendering support
  let formattedText = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br/>');
    
  msgEl.innerHTML = formattedText;
  container.appendChild(msgEl);
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function showChatTypingIndicator() {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  
  const id = 'typing-' + Date.now();
  const typingEl = document.createElement('div');
  typingEl.id = id;
  typingEl.className = 'chat-msg typing';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeChatTypingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ---- Large AI Chatbot Logic ----
let chatHistoryLarge = [];

function toggleChatSettingsLarge() {
  const drawer = document.getElementById('chat-settings-drawer-large');
  if (!drawer) return;
  drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
}

function saveChatApiKeyLarge(val) {
  localStorage.setItem('groq_api_key', val.trim());
  loadChatApiKey();
  loadChatApiKeyLarge();
}

function loadChatApiKeyLarge() {
  const key = localStorage.getItem('groq_api_key') || '';
  const input = document.getElementById('chat-api-key-large');
  if (input) input.value = key;
}

function sendChatChipLarge(text) {
  const input = document.getElementById('chat-input-large');
  if (input) {
    input.value = text;
    handleChatSubmitLarge(new Event('submit'));
  }
}

async function handleChatSubmitLarge(e) {
  if (e) e.preventDefault();
  
  const input = document.getElementById('chat-input-large');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  input.value = '';
  
  // Append User message to UI
  appendChatMessageLarge(text, 'user');
  
  // Track history
  chatHistoryLarge.push({ role: 'user', content: text });
  if (chatHistoryLarge.length > 10) chatHistoryLarge.shift();
  
  // Show typing indicator
  const typingId = showChatTypingIndicatorLarge();
  
  try {
    const userKey = localStorage.getItem('groq_api_key') || '';
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        api_key: userKey,
        history: chatHistoryLarge,
        language: currentLang || 'en'
      })
    });
    
    // Remove typing indicator
    removeChatTypingIndicatorLarge(typingId);
    
    const data = await res.json();
    if (res.ok && data.reply) {
      appendChatMessageLarge(data.reply, 'assistant');
      chatHistoryLarge.push({ role: 'assistant', content: data.reply });
      if (chatHistoryLarge.length > 10) chatHistoryLarge.shift();
    } else {
      appendChatMessageLarge(data.error || 'Failed to get a response.', 'error');
    }
  } catch (err) {
    removeChatTypingIndicatorLarge(typingId);
    appendChatMessageLarge('Network error occurred. Please check connection.', 'error');
    console.error('Chat error:', err);
  }
}

function appendChatMessageLarge(text, sender) {
  const container = document.getElementById('chat-messages-large');
  if (!container) return;
  
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${sender}`;
  
  // Basic markdown rendering support
  let formattedText = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br/>');
    
  msgEl.innerHTML = formattedText;
  container.appendChild(msgEl);
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function showChatTypingIndicatorLarge() {
  const container = document.getElementById('chat-messages-large');
  if (!container) return null;
  
  const id = 'typing-large-' + Date.now();
  const typingEl = document.createElement('div');
  typingEl.id = id;
  typingEl.className = 'chat-msg typing';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeChatTypingIndicatorLarge(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function clearChat() {
  chatHistory = [];
  const container = document.getElementById('chat-messages');
  if (container) {
    container.innerHTML = `
      <div class="chat-msg assistant">
        Hello! I am your CivicEye safety assistant. Ask me anything about reporting potholes, flooding, garbage, stray animals, or first aid instructions!
      </div>
    `;
  }
  showToast('🧹 Chat history cleared');
}

function clearChatLarge() {
  chatHistoryLarge = [];
  const container = document.getElementById('chat-messages-large');
  if (container) {
    container.innerHTML = `
      <div class="chat-msg assistant">
        Hello! I am CivicEye AI. You can ask me anything you need help with—including reporting issues, safety tips, first aid guides, or normal everyday assistance! How can I help you today?
      </div>
    `;
  }
  showToast('🧹 Chat history cleared');
}

// ---- Welcome Overlay Logic ----
function closeWelcomeOverlay() {
  const overlay = document.getElementById('welcome-overlay');
  if (!overlay) return;
  
  overlay.style.opacity = '0';
  sessionStorage.setItem('civiceye_welcomed', 'true');
  
  setTimeout(() => {
    overlay.style.visibility = 'hidden';
    overlay.style.display = 'none';
  }, 600);
}

function initWelcomeOverlay() {
  const overlay = document.getElementById('welcome-overlay');
  if (!overlay) return;
  
  const welcomed = sessionStorage.getItem('civiceye_welcomed');
  if (welcomed === 'true') {
    overlay.style.display = 'none';
    overlay.style.visibility = 'hidden';
    overlay.style.opacity = '0';
  }
}

// ---- Civic Riddle Game ----
let currentRiddle = null;
let riddleScore = 0;
let hasAnsweredRiddle = false;

function initRiddleGame() {
  riddleScore = 0;
  loadDynamicRiddle();
}

async function loadDynamicRiddle() {
  hasAnsweredRiddle = false;
  
  const qText = document.getElementById('riddle-text');
  if (qText) qText.innerHTML = "🌀 Gathering stardust... AI is creating a custom safety riddle...";
  
  const container = document.getElementById('riddle-choices-container');
  if (container) container.innerHTML = "";
  
  const feedback = document.getElementById('riddle-feedback-text');
  if (feedback) feedback.textContent = "";
  
  const nextBtn = document.getElementById('riddle-next-btn');
  if (nextBtn) nextBtn.style.display = 'none';
  
  const scoreVal = document.getElementById('riddle-score-val');
  if (scoreVal) scoreVal.textContent = riddleScore;
  
  try {
    const res = await fetch('/generate-riddle');
    const riddle = await res.json();
    currentRiddle = riddle;
    
    if (qText) qText.textContent = riddle.question;
    
    if (container) {
      container.innerHTML = riddle.choices.map((choice, i) => `
        <button class="riddle-choice-btn" onclick="selectDynamicRiddleChoice(${i}, this)">
          ${choice}
        </button>
      `).join('');
    }
    if (feedback) feedback.textContent = "Select an answer to solve the riddle!";
  } catch (err) {
    console.error('Failed to load riddle:', err);
    if (qText) qText.textContent = "Error gathering riddle stardust. Click below to retry.";
    if (nextBtn) {
      nextBtn.style.display = 'block';
      nextBtn.textContent = 'Retry 🔄';
    }
  }
}

function selectDynamicRiddleChoice(choiceIdx, btn) {
  if (hasAnsweredRiddle) return;
  hasAnsweredRiddle = true;
  
  const feedback = document.getElementById('riddle-feedback-text');
  const nextBtn = document.getElementById('riddle-next-btn');
  
  const choiceButtons = document.querySelectorAll('.riddle-choice-btn');
  choiceButtons.forEach((b, idx) => {
    if (idx === currentRiddle.correct) {
      b.classList.add('correct');
    } else if (idx === choiceIdx) {
      b.classList.add('wrong');
    }
  });
  
  // Get button coordinates to spawn sparkles directly from the button!
  const rect = btn.getBoundingClientRect();
  const clickX = rect.left + rect.width / 2;
  const clickY = rect.top + rect.height / 2;
  
  if (choiceIdx === currentRiddle.correct) {
    riddleScore++;
    if (feedback) feedback.textContent = "🎉 Correct! " + currentRiddle.hint;
    // Massive sparkle burst!
    spawnSparkles(clickX, clickY);
    setTimeout(() => spawnSparkles(clickX + 50, clickY - 20), 120);
    setTimeout(() => spawnSparkles(clickX - 50, clickY + 20), 240);
  } else {
    if (feedback) feedback.textContent = "❌ Incorrect. Hint: " + currentRiddle.hint;
    // Spawns smaller burst
    spawnSparkles(clickX, clickY);
  }
  
  const scoreVal = document.getElementById('riddle-score-val');
  if (scoreVal) scoreVal.textContent = riddleScore;
  
  if (nextBtn) {
    nextBtn.style.display = 'block';
    nextBtn.textContent = 'Next Riddle ➡️';
  }
}

function nextRiddleQuestion() {
  loadDynamicRiddle();
}

// ---- Init ----
async function init() {
  initTheme();
  initWelcomeOverlay();
  initRiddleGame();
  initParticles();
  await loadLang('en');
  await loadStats();
  await loadGuidelines();
  loadChatApiKey();
  loadChatApiKeyLarge();
  // Auto-refresh stats every 60s
  setInterval(loadStats, 60000);
}

document.addEventListener('DOMContentLoaded', init);
