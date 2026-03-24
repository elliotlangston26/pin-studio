/* =================================
   Pin Studio – App Logic
   ================================= */

'use strict';

// ── Constants ──────────────────────────────────────────────

const STORAGE_KEY = 'pinStudio_collection';

const CAT_ICONS = {
  'Marvel':     '⚡',
  'Star Wars':  '✦',
  'Disney':     '✨',
  'Anime':      '★',
  'Pokemon':    '◈',
  'Games':      '◉',
  'Culture':    '◆',
  'Japan':      '⛩',
  'England':    '◇',
  'Tokusatsu':  '⬡',
  'Other':      '○',
};

const CAT_CLASS = {
  'Marvel':     'cat-marvel',
  'Star Wars':  'cat-star-wars',
  'Disney':     'cat-disney',
  'Anime':      'cat-anime',
  'Pokemon':    'cat-pokemon',
  'Games':      'cat-games',
  'Culture':    'cat-culture',
  'Japan':      'cat-japan',
  'England':    'cat-england',
  'Tokusatsu':  'cat-tokusatsu',
  'Other':      'cat-other',
};

const PIN_COLOURS = [
  '#ff6b9d','#ffaac8','#ffd166','#06d6a0',
  '#7c4dff','#b44bc1','#f72585','#4cc9f0',
  '#e63946','#2dc653','#ff9f1c','#9b5de5',
  '#4361ee','#48cae4','#e76f51','#a8dadc'
];

// ── State ──────────────────────────────────────────────────

let pins          = [];
let editingId     = null;
let pendingDeleteId = null;
let currentPhotoData = null;
let searchQuery   = '';
let formSnapshot  = null;   // snapshot of form state when modal opened

// ── DOM refs ──────────────────────────────────────────────

const pinGrid          = document.getElementById('pinGrid');
const emptyState       = document.getElementById('emptyState');
const totalCount       = document.getElementById('totalCount');
const categoryCount    = document.getElementById('categoryCount');
const displayCount     = document.getElementById('displayCount');
const filterCategory   = document.getElementById('filterCategory');
const sortOrder        = document.getElementById('sortOrder');
const searchInput      = document.getElementById('searchInput');

const modalOverlay     = document.getElementById('modalOverlay');
const closeModalBtn    = document.getElementById('closeModalBtn');
const cancelBtn        = document.getElementById('cancelBtn');
const modalTitle       = document.getElementById('modalTitle');
const submitBtn        = document.getElementById('submitBtn');

const pinForm          = document.getElementById('pinForm');
const editIdInput      = document.getElementById('editId');
const pinNameInput     = document.getElementById('pinName');
const pinCategorySel   = document.getElementById('pinCategory');
const pinNotesInput    = document.getElementById('pinNotes');

const photoUploadArea  = document.getElementById('photoUploadArea');
const photoInput       = document.getElementById('photoInput');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const photoPreview     = document.getElementById('photoPreview');
const photoRemoveBtn   = document.getElementById('photoRemoveBtn');

const toast            = document.getElementById('toast');
const deleteOverlay    = document.getElementById('deleteOverlay');
const closeDeleteBtn   = document.getElementById('closeDeleteBtn');
const cancelDeleteBtn  = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const deleteNameDisplay= document.getElementById('deleteNameDisplay');

const exportBtn        = document.getElementById('exportBtn');
const importInput      = document.getElementById('importInput');

// ── Environment detection ─────────────────────────────────
// When deployed to Vercel, photos are stored in Vercel Blob via /api/upload.
// When running locally (localhost / file://), we fall back to base64 so the
// app still works without any server setup.
const IS_DEPLOYED = !['localhost', '127.0.0.1', ''].includes(window.location.hostname);

// ── Auth helpers ──────────────────────────────────────────

const AUTH_KEY        = 'pinStudio_token';
const GUEST_FLAG_KEY  = 'pinStudio_guest';
const GUEST_PINS_KEY  = 'pinStudio_guest_pins';

function getToken()      { return localStorage.getItem(AUTH_KEY); }
function saveToken(t)    { localStorage.setItem(AUTH_KEY, t); }
function clearToken()    { localStorage.removeItem(AUTH_KEY); }
function isGuestMode()   { return localStorage.getItem(GUEST_FLAG_KEY) === '1'; }
function setGuestMode()  { localStorage.setItem(GUEST_FLAG_KEY, '1'); }
function clearGuestMode(){ localStorage.removeItem(GUEST_FLAG_KEY); }
function isLoggedIn()    { return !!getToken() || isGuestMode(); }
function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getToken()}`, ...extra };
}

function loadGuestPins() {
  try { return JSON.parse(localStorage.getItem(GUEST_PINS_KEY) || '[]'); } catch { return []; }
}
function saveGuestPins(list) {
  localStorage.setItem(GUEST_PINS_KEY, JSON.stringify(list));
}

// ── Storage ───────────────────────────────────────────────

async function loadPins() {
  if (!isLoggedIn()) return [];
  if (isGuestMode()) return loadGuestPins();
  const res = await fetch('/api/pins', { headers: authHeaders() });
  if (res.status === 401) { handleLogout(); return []; }
  return res.ok ? res.json() : [];
}

// ── Scene decoration ──────────────────────────────────────

function buildStars() {
  const container = document.getElementById('stars');
  if (!container) return;
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('div');
    s.className = 'star-dot';
    const size = 1 + Math.random() * 2.5;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      top:${Math.random() * 70}%;
      left:${Math.random() * 100}%;
      --opacity:${0.4 + Math.random() * 0.6};
      --dur:${2 + Math.random() * 4}s;
      --delay:-${Math.random() * 4}s;
    `;
    container.appendChild(s);
  }
}

function buildClouds() {
  const container = document.getElementById('clouds');
  if (!container) return;
  const configs = [
    { top: 12, w: 280, h: 60, dur: 80, delay: 0 },
    { top: 22, w: 200, h: 40, dur: 65, delay: -20 },
    { top: 35, w: 340, h: 70, dur: 95, delay: -45 },
    { top: 8,  w: 160, h: 36, dur: 55, delay: -10 },
    { top: 48, w: 260, h: 50, dur: 110, delay: -30 },
  ];
  configs.forEach(c => {
    const el = document.createElement('div');
    el.className = 'cloud';
    el.style.cssText = `
      top:${c.top}%; width:${c.w}px; height:${c.h}px;
      --dur:${c.dur}s; --delay:${c.delay}s;
      left:-${c.w + 50}px;
    `;
    container.appendChild(el);
  });
}

function buildFloatingPins() {
  const container = document.getElementById('floatingPins');
  if (!container) return;
  const positions = [
    [6, 5], [14, 88], [22, 22], [38, 92], [55, 8],
    [70, 82], [82, 18], [90, 65], [48, 96], [30, 3],
    [62, 3], [10, 50], [88, 44]
  ];
  positions.forEach(([top, left], i) => {
    const el = document.createElement('div');
    el.className = 'fp';
    const size = 20 + (i % 4) * 10;
    el.style.cssText = `
      top:${top}%; left:${left}%;
      width:${size}px; height:${size}px;
      background:${PIN_COLOURS[i % PIN_COLOURS.length]};
      --dur:${4 + (i % 4)}s;
      --delay:-${(i * 0.6).toFixed(1)}s;
    `;
    container.appendChild(el);
  });
}

function buildFooterPins() {
  const row = document.getElementById('footerPins');
  if (!row) return;
  PIN_COLOURS.forEach((colour, i) => {
    const el = document.createElement('div');
    el.className = 'footer-pin';
    el.style.cssText = `background:${colour}; --dur:${3 + (i % 3)}s; --delay:-${(i * 0.4).toFixed(1)}s;`;
    row.appendChild(el);
  });
}

buildStars();
buildClouds();
buildFloatingPins();
buildFooterPins();

// ── Category filter dropdown ──────────────────────────────

function buildCategoryFilter() {
  // Remove existing dynamic options (keep "all" and "__favs__")
  filterCategory.querySelectorAll('option:not([value="all"]):not([value="__favs__"])').forEach(o => o.remove());

  // Favourites option — show only when at least one pin is favourited
  const favCount = pins.filter(p => p.favourite).length;
  let favsOpt = filterCategory.querySelector('option[value="__favs__"]');
  if (favCount > 0) {
    if (!favsOpt) {
      favsOpt = document.createElement('option');
      favsOpt.value = '__favs__';
      // Insert right after "all" option
      const allOpt = filterCategory.querySelector('option[value="all"]');
      allOpt.insertAdjacentElement('afterend', favsOpt);
    }
    favsOpt.textContent = `★ Favourites (${favCount})`;
  } else {
    if (favsOpt) {
      favsOpt.remove();
      if (filterCategory.value === '__favs__') filterCategory.value = 'all';
    }
  }

  // Category options with pin counts
  const used = [...new Set(pins.map(p => p.category))].sort();
  used.forEach(cat => {
    const count = pins.filter(p => p.category === cat).length;
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = `${cat} (${count})`;
    filterCategory.appendChild(opt);
  });
}

// ── Render ────────────────────────────────────────────────

function getFilteredSorted() {
  const cat  = filterCategory.value;
  const sort = sortOrder.value;

  let list;
  if (cat === 'all')      list = [...pins];
  else if (cat === '__favs__') list = pins.filter(p => p.favourite);
  else                    list = pins.filter(p => p.category === cat);

  // Search filter (name or notes)
  if (searchQuery) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      (p.notes && p.notes.toLowerCase().includes(searchQuery))
    );
  }

  if (sort === 'newest')    list.sort((a, b) => b.createdAt - a.createdAt);
  if (sort === 'oldest')    list.sort((a, b) => a.createdAt - b.createdAt);
  if (sort === 'name-az')   list.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'name-za')   list.sort((a, b) => b.name.localeCompare(a.name));
  if (sort === 'category')  list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  if (sort === 'fav-first') list.sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || b.createdAt - a.createdAt);

  return list;
}

function render() {
  buildCategoryFilter();

  const uniqueCats = new Set(pins.map(p => p.category));
  totalCount.textContent    = pins.length;
  categoryCount.textContent = uniqueCats.size;

  const list = getFilteredSorted();
  displayCount.textContent  = `${list.length} pin badge${list.length !== 1 ? 's' : ''}`;

  emptyState.style.display = pins.length === 0 ? 'flex' : 'none';
  pinGrid.style.display    = pins.length === 0 ? 'none'  : 'grid';

  pinGrid.innerHTML = '';
  list.forEach(pin => pinGrid.appendChild(buildCard(pin)));
}

function buildCard(pin) {
  const card = document.createElement('article');
  card.className = 'pin-card';
  card.dataset.id = pin.id;

  const isFav  = !!pin.favourite;
  const favTip = isFav ? 'Remove from favourites' : 'Add to favourites';

  let imageHTML;
  if (pin.photo) {
    imageHTML = `
      <div class="pin-card-image">
        <img src="${pin.photo}" alt="${escHtml(pin.name)}" loading="lazy" />
      </div>`;
  } else {
    imageHTML = `
      <div class="pin-card-no-image">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="18" r="12" fill="#ffaac8" stroke="#ff6b9d" stroke-width="2"/>
          <circle cx="24" cy="18" r="6" fill="#fff" opacity="0.7"/>
          <rect x="22" y="30" width="4" height="12" fill="#c9a84c" rx="2"/>
        </svg>
        <span>No photo</span>
      </div>`;
  }

  const catClass = CAT_CLASS[pin.category] || 'cat-other';
  const catIcon  = CAT_ICONS[pin.category] || '○';
  const notesHTML = pin.notes
    ? `<p class="pin-card-notes">${escHtml(pin.notes)}</p>`
    : '';

  card.innerHTML = `
    ${imageHTML}
    <div class="pin-card-body">
      <p class="pin-card-name">${escHtml(pin.name)}</p>
      <div class="pin-card-meta">
        <span class="category-badge ${catClass}">${catIcon} ${escHtml(pin.category)}</span>
        <button class="btn-fav${isFav ? ' is-fav' : ''}" data-action="favourite" data-id="${pin.id}" title="${favTip}" aria-label="${favTip}">
          <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
      </div>
      ${notesHTML}
    </div>
    <div class="pin-card-footer">
      <button class="btn-card btn-card-edit" data-action="edit" data-id="${pin.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit
      </button>
      <button class="btn-card btn-card-delete" data-action="delete" data-id="${pin.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Remove
      </button>
    </div>`;

  return card;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Modal ─────────────────────────────────────────────────

function snapFormState() {
  return {
    name:     pinNameInput.value,
    category: pinCategorySel.value,
    notes:    pinNotesInput.value,
    photo:    currentPhotoData,
  };
}

function isFormDirty() {
  if (!formSnapshot) return false;
  const cur = snapFormState();
  return JSON.stringify(cur) !== JSON.stringify(formSnapshot);
}

function openModal(pin = null) {
  pinForm.reset();
  currentPhotoData = null;
  clearPhotoPreview();

  if (pin) {
    editingId              = pin.id;
    editIdInput.value      = pin.id;
    pinNameInput.value     = pin.name;
    pinCategorySel.value   = pin.category;
    pinNotesInput.value    = pin.notes || '';
    modalTitle.textContent = 'Edit Pin Badge';
    submitBtn.textContent  = 'Save Changes';
    if (pin.photo) { currentPhotoData = pin.photo; showPhotoPreview(pin.photo); }
  } else {
    editingId              = null;
    editIdInput.value      = '';
    modalTitle.textContent = 'Add New Pin Badge';
    submitBtn.textContent  = 'Add Pin Badge';
  }

  formSnapshot = snapFormState();   // capture clean state for dirty-checking
  modalOverlay.classList.add('active');
  setTimeout(() => pinNameInput.focus(), 80);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  editingId    = null;
  currentPhotoData = null;
  formSnapshot = null;
}

// Checks for unsaved changes before closing
function safeCloseModal() {
  if (isFormDirty()) {
    if (!confirm('You have unsaved changes. Discard them?')) return;
  }
  closeModal();
}

function showPhotoPreview(src) {
  photoPreview.src        = src;
  photoPreview.hidden     = false;
  photoPlaceholder.hidden = true;
  photoRemoveBtn.hidden   = false;
}

function clearPhotoPreview() {
  photoPreview.src        = '';
  photoPreview.hidden     = true;
  photoPlaceholder.hidden = false;
  photoRemoveBtn.hidden   = true;
  photoInput.value        = '';
}

// ── Delete modal ──────────────────────────────────────────

function openDeleteModal(id) {
  const pin = pins.find(p => p.id === id);
  if (!pin) return;
  pendingDeleteId = id;
  deleteNameDisplay.textContent = pin.name;
  deleteOverlay.classList.add('active');
}

function closeDeleteModal() {
  deleteOverlay.classList.remove('active');
  pendingDeleteId = null;
}

// ── CRUD ──────────────────────────────────────────────────

async function addPin(data) {
  if (isGuestMode()) {
    const pin = { ...data, id: Date.now(), created_at: new Date().toISOString() };
    pins.unshift(pin);
    saveGuestPins(pins);
    return;
  }
  const res = await fetch('/api/pins', {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save pin');
  const pin = await res.json();
  pins.unshift(pin);
}

async function updatePin(id, data) {
  if (isGuestMode()) {
    const idx = pins.findIndex(p => p.id === id);
    if (idx !== -1) { pins[idx] = { ...pins[idx], ...data }; saveGuestPins(pins); }
    return;
  }
  const res = await fetch(`/api/pins/${id}`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update pin');
  const updated = await res.json();
  const idx = pins.findIndex(p => p.id === id);
  if (idx !== -1) pins[idx] = updated;
}

async function deletePin(id) {
  if (isGuestMode()) {
    pins = pins.filter(p => p.id !== id);
    saveGuestPins(pins);
    return;
  }
  await fetch(`/api/pins/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
  });
  pins = pins.filter(p => p.id !== id);
}

async function toggleFavourite(id) {
  const pin = pins.find(p => p.id === id);
  if (!pin) return;
  const wasFav = !!pin.favourite;
  await updatePin(id, { ...pin, favourite: !wasFav });
  render();
  showToast(wasFav ? `"${pin.name}" removed from favourites` : `"${pin.name}" added to favourites ★`);
}

// ── Export / Import ───────────────────────────────────────

function exportCollection() {
  if (pins.length === 0) { showToast('Nothing to export — collection is empty'); return; }
  const payload = { version: 1, exportedAt: new Date().toISOString(), pins };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `pin-studio-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Collection exported (${pins.length} pin badge${pins.length !== 1 ? 's' : ''})`);
}

function importCollection(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const importedPins = Array.isArray(data) ? data : Array.isArray(data.pins) ? data.pins : null;
      if (!importedPins) { showToast('Invalid backup file'); return; }

      const existingIds = new Set(pins.map(p => p.id));
      const newPins = importedPins.filter(p => p.id && p.name && p.category && !existingIds.has(p.id));

      if (newPins.length === 0) {
        showToast('No new pin badges found in this backup');
        return;
      }

      if (!confirm(`Import ${newPins.length} new pin badge${newPins.length !== 1 ? 's' : ''}? Your existing collection will not be changed.`)) return;

      let imported = 0;
      for (const p of newPins) {
        try {
          await addPin({ name: p.name, category: p.category, notes: p.notes || null, photo: p.photo || null });
          imported++;
        } catch { /* skip failed pins */ }
      }
      render();
      showToast(`Imported ${imported} pin badge${imported !== 1 ? 's' : ''}!`);
    } catch {
      showToast('Could not read backup file');
    }
    // Reset input so the same file can be re-imported after edits
    importInput.value = '';
  };
  reader.readAsText(file);
}

// ── Toast ─────────────────────────────────────────────────

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ── Events ────────────────────────────────────────────────

// All "open modal" buttons
['openModalBtn', 'openModalBtn2', 'openModalBtnBar', 'emptyAddBtn'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => openModal());
});

// CTA hero button — scroll to collection, then open modal if empty
const ctaBtn = document.getElementById('ctaBtn');
if (ctaBtn) {
  ctaBtn.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
    if (pins.length === 0) {
      setTimeout(() => openModal(), 600);
    }
  });
}

// Modal close — use safeCloseModal to catch unsaved changes
closeModalBtn.addEventListener('click', safeCloseModal);
cancelBtn.addEventListener('click', safeCloseModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) safeCloseModal(); });

closeDeleteBtn.addEventListener('click', closeDeleteModal);
cancelDeleteBtn.addEventListener('click', closeDeleteModal);
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteModal(); });

confirmDeleteBtn.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const pin = pins.find(p => p.id === pendingDeleteId);
  await deletePin(pendingDeleteId);
  closeDeleteModal();
  render();
  showToast(`"${pin?.name}" removed from collection`);
});

// ── Photo helpers ─────────────────────────────────────────

// Single entry point for both the file input and drag-and-drop handlers.
// When deployed to Vercel: uploads the file to /api/upload → Vercel Blob,
// returns a permanent public URL.
// When running locally: converts to base64 via FileReader (no server needed).
function getImageContentType(file) {
  if (file.type && file.type.startsWith('image/')) return file.type;
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.jpeg') || name.endsWith('.jpg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function handlePhotoFile(file) {
  if (!file) return;
  const contentType = getImageContentType(file);
  if (!contentType.startsWith('image/')) {
    showToast('Invalid file type - please select an image');
    return;
  }
  if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5 MB'); return; }

  if (IS_DEPLOYED) {
    showToast('Uploading photo…');
    try {
      const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': contentType },
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      currentPhotoData = url;
      showPhotoPreview(url);
    } catch (err) {
      console.error('[photo upload]', err);
      showToast('Photo upload failed — please try again');
    }
  } else {
    // Local dev: base64 fallback
    const reader = new FileReader();
    reader.onload = e => { currentPhotoData = e.target.result; showPhotoPreview(currentPhotoData); };
    reader.readAsDataURL(file);
  }
}

// Photo upload events
photoUploadArea.addEventListener('click', e => {
  if (e.target === photoRemoveBtn) return;
  photoInput.click();
});

photoRemoveBtn.addEventListener('click', e => {
  e.stopPropagation();
  currentPhotoData = null;
  clearPhotoPreview();
});

photoInput.addEventListener('change', () => handlePhotoFile(photoInput.files[0]));

photoUploadArea.addEventListener('dragover', e => {
  e.preventDefault();
  photoUploadArea.style.borderColor = 'var(--purple)';
  photoUploadArea.style.background  = 'var(--purple-pale)';
});
photoUploadArea.addEventListener('dragleave', () => {
  photoUploadArea.style.borderColor = '';
  photoUploadArea.style.background  = '';
});
photoUploadArea.addEventListener('drop', e => {
  e.preventDefault();
  photoUploadArea.style.borderColor = '';
  photoUploadArea.style.background  = '';
  handlePhotoFile(e.dataTransfer.files[0]);
});

// Form submit
pinForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name     = pinNameInput.value.trim();
  const category = pinCategorySel.value;
  const notes    = pinNotesInput.value.trim();

  if (!name)     { showToast('Please enter a pin badge name'); pinNameInput.focus(); return; }
  if (!category) { showToast('Please select a category'); pinCategorySel.focus(); return; }

  const data = { name, category, notes, photo: currentPhotoData || null };

  try {
    if (editingId) {
      const existing = pins.find(p => p.id === editingId);
      await updatePin(editingId, { ...data, favourite: existing ? !!existing.favourite : false });
      showToast(`"${name}" updated!`);
    } else {
      await addPin(data);
      showToast(`"${name}" added to your collection!`);
    }
    closeModal();   // direct close — no dirty check needed after a successful save
    render();
  } catch {
    showToast('Could not save pin — please try again');
  }
});

// Pin grid delegation — button actions + click-anywhere-on-card to edit
pinGrid.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (btn) {
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit')      { const p = pins.find(p => p.id === id); if (p) openModal(p); }
    if (btn.dataset.action === 'delete')    openDeleteModal(id);
    if (btn.dataset.action === 'favourite') toggleFavourite(id);
    return;
  }
  // Click anywhere else on card body/image opens edit
  const card = e.target.closest('.pin-card');
  if (card) {
    const p = pins.find(p => p.id === card.dataset.id);
    if (p) openModal(p);
  }
});

filterCategory.addEventListener('change', render);
sortOrder.addEventListener('change', render);

if (searchInput) {
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    render();
  });
}

// Export button
if (exportBtn) exportBtn.addEventListener('click', exportCollection);

// Import — triggered via hidden file input inside the label
if (importInput) importInput.addEventListener('change', () => importCollection(importInput.files[0]));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (modalOverlay.classList.contains('active'))  safeCloseModal();
    if (deleteOverlay.classList.contains('active')) closeDeleteModal();
    if (authOverlay?.classList.contains('active'))  closeAuthModal();
  }
});

// ── Theme switcher ────────────────────────────────────────

const THEME_KEY   = 'pinStudio_theme';
const themeSelect = document.getElementById('themeSelect');

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  if (themeSelect) themeSelect.value = theme;
}

if (themeSelect) {
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
}

// ── Auth modal ────────────────────────────────────────────

const authOverlay = document.getElementById('authOverlay');

function openAuthModal() {
  authOverlay.classList.add('active');
  setTimeout(() => document.getElementById('authEmail').focus(), 80);
}

function closeAuthModal() {
  authOverlay.classList.remove('active');
}

function updateAuthButtons() {
  const signUpBtn = document.getElementById('signUpBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  if (isLoggedIn()) {
    signUpBtn.style.display = 'none';
    logoutBtn.style.display = '';
    if (isGuestMode()) logoutBtn.textContent = 'Exit Test Mode';
    else logoutBtn.textContent = 'Log out';
  } else {
    signUpBtn.style.display = '';
    logoutBtn.style.display = 'none';
  }
}

function handleLogout() {
  clearToken();
  clearGuestMode();
  pins = [];
  updateAuthButtons();
  render();
}

document.getElementById('signUpBtn').addEventListener('click', openAuthModal);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('closeAuthBtn').addEventListener('click', closeAuthModal);
document.getElementById('cancelAuthBtn').addEventListener('click', closeAuthModal);
authOverlay.addEventListener('click', e => { if (e.target === authOverlay) closeAuthModal(); });

document.getElementById('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const isSignup = document.getElementById('authMode').dataset.mode === 'signup';
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name     = document.getElementById('authName').value.trim();

  const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
  const body     = isSignup ? { email, password, name } : { email, password };

  try {
    const res  = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Authentication failed'); return; }

    saveToken(data.token);
    pins = await loadPins();
    closeAuthModal();
    updateAuthButtons();
    render();
    showToast(`Welcome${isSignup ? '' : ' back'}, ${data.user.name}!`);
  } catch {
    showToast('Network error — please try again');
  }
});

document.getElementById('authToggleLink').addEventListener('click', e => {
  e.preventDefault();
  const modeEl   = document.getElementById('authMode');
  const isSignup = modeEl.dataset.mode === 'signup';
  modeEl.dataset.mode = isSignup ? 'login' : 'signup';
  document.getElementById('authNameGroup').style.display = isSignup ? 'none' : 'block';
  document.getElementById('authTitle').textContent       = isSignup ? 'Welcome back' : 'Create your account';
  document.getElementById('authSubmitBtn').textContent   = isSignup ? 'Log in' : 'Create account';
  document.getElementById('authToggleText').textContent  = isSignup ? "Don't have an account? " : 'Already have an account? ';
  document.getElementById('authToggleLink').textContent  = isSignup ? 'Sign up' : 'Log in';
});

document.getElementById('guestModeBtn').addEventListener('click', async () => {
  setGuestMode();
  pins = loadGuestPins();
  closeAuthModal();
  updateAuthButtons();
  render();
  showToast('Test mode active — your pins are saved locally only');
});

// ── Guard: redirect unauthenticated "add pin" clicks to auth modal ────────────

const _openModal = openModal;
// Patch openModal so that clicking any Add Pin button while logged out
// opens the auth modal instead.
openModal = function(pin = null) {
  if (!isLoggedIn()) { openAuthModal(); return; }
  _openModal(pin);
};

// ── Init ──────────────────────────────────────────────────

async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'fun');
  updateAuthButtons();
  if (isLoggedIn()) {
    pins = await loadPins();
  }
  render();
}

init();
