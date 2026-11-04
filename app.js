const STORAGE_KEY = 'cep-listem.encrypted.v1';
const APP_VERSION = '1.0.43';
const BACKUP_FORMAT = 'cep-listem-backup';
const BACKUP_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (id) => document.getElementById(id);
let cryptoKey = null;
let appData = null;
let currentPage = 'home';
let currentNoteId = null;
let searchQuery = '';
let noteSort = 'newest';
let upcomingTab = 'upcoming';
let previousImageMode = 'spark';
let activePinInput = null;
const reauthenticatedNotes = new Set();
let toastTimer;

function updateAppViewportHeight() {
  const installed = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const screenHeight = window.innerWidth > window.innerHeight ? window.screen.width : window.screen.height;
  const height = installed ? Math.max(window.innerHeight, screenHeight) : window.innerHeight;
  document.documentElement.style.setProperty('--app-full-height', `${height}px`);
}
updateAppViewportHeight();
window.addEventListener('resize', updateAppViewportHeight);
window.screen.orientation?.addEventListener('change', updateAppViewportHeight);

document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });
document.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });
document.addEventListener('touchmove', (event) => {
  if (event.touches.length > 1) event.preventDefault();
}, { passive: false });

function bytesToBase64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function initialData() { return { schema: 3, notes: [], pinnedNoteId: null, homeImageMode: 'spark', homeImageData: '' }; }
function legacyItemsToNotes(menus) {
  const notes = [];
  for (const menu of menus.slice(0, 100)) {
    if (!menu || !Array.isArray(menu.items)) continue;
    for (const item of menu.items.slice(0, 10000)) {
      if (!item || typeof item.title !== 'string') continue;
      const parts = [];
      if (item.details) parts.push(String(item.details));
      if (item.amount) parts.push(`Ücret: ${item.amount} / ${item.period || 'ay'}`);
      if (item.username) parts.push(`Kullanıcı adı: ${item.username}`);
      if (item.secret) parts.push(`Şifre: ${item.secret}`);
      notes.push({ id: String(item.id || makeId()), title: item.title, body: parts.join('\n'), date: String(item.date || ''), dateSensitive: !!item.date, requiresPassword: menu.type === 'passwords', done: !!item.done, createdAt: Number(item.createdAt) || Date.now(), pinned: !!item.pinned });
    }
  }
  return notes;
}
function validateData(value) {
  if (!value || ![1, 2, 3].includes(value.schema)) throw new Error('Yedek dosyasının biçimi geçerli değil.');
  if (value.schema === 1) {
    if (!Array.isArray(value.lists)) throw new Error('Yedek dosyasındaki listeler geçersiz.');
    const notes = [];
    for (const list of value.lists.slice(0, 100)) for (const task of (Array.isArray(list?.tasks) ? list.tasks.slice(0, 10000) : [])) {
      if (!task || typeof task.text !== 'string') continue;
      notes.push({ id: String(task.id || makeId()), title: task.text, body: list.name ? `Liste: ${list.name}` : '', date: '', dateSensitive: false, requiresPassword: false, done: !!task.done, createdAt: Number(task.createdAt) || Date.now(), pinned: false });
    }
    return normalizeNotes(notes, null, 'spark', '');
  }
  if (value.schema === 2) {
    if (!Array.isArray(value.menus)) throw new Error('Yedek dosyasındaki menüler geçersiz.');
    const notes = legacyItemsToNotes(value.menus);
    const pinned = value.menus.flatMap((menu) => Array.isArray(menu?.items) ? menu.items : []).find((item) => item?.pinned);
    return normalizeNotes(notes, pinned?.id || null, value.homeImage ? 'custom' : 'spark', value.homeImage || '');
  }
  if (!Array.isArray(value.notes) || value.notes.length > 50000) throw new Error('Yedek dosyasındaki notlar geçersiz.');
  const notes = value.notes.map((note) => {
    if (!note || typeof note.id !== 'string' || typeof note.title !== 'string' || typeof note.body !== 'string') throw new Error('Yedek dosyasındaki not bilgileri geçersiz.');
    const date = typeof note.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(note.date) ? note.date : '';
    return { id: note.id.slice(0, 100), title: note.title.slice(0, 120), body: note.body.slice(0, 12000), date, dateSensitive: !!note.dateSensitive && !!date, requiresPassword: !!note.requiresPassword, done: !!note.done, createdAt: Number(note.createdAt) || Date.now(), pinned: !!note.pinned };
  });
  return normalizeNotes(notes, value.pinnedNoteId, ['spark', 'logo', 'custom'].includes(value.homeImageMode) ? value.homeImageMode : 'spark', typeof value.homeImageData === 'string' && value.homeImageData.length < 2_500_000 ? value.homeImageData : '');
}
function normalizeNotes(notes, pinnedNoteId, homeImageMode, homeImageData) {
  const safeNotes = notes.slice(0, 50000).map((note) => ({ id: String(note.id || makeId()).slice(0, 100), title: String(note.title || '').slice(0, 120), body: String(note.body || '').slice(0, 12000), date: String(note.date || ''), dateSensitive: !!note.dateSensitive && !!note.date, requiresPassword: !!note.requiresPassword, done: !!note.done, createdAt: Number(note.createdAt) || Date.now(), pinned: !!note.pinned }));
  let pin = safeNotes.find((note) => note.id === pinnedNoteId)?.id || null;
  if (!pin) pin = safeNotes.find((note) => note.pinned)?.id || null;
  safeNotes.forEach((note) => { note.pinned = note.id === pin; });
  return { schema: 3, notes: safeNotes, pinnedNoteId: pin, homeImageMode, homeImageData };
}
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptData(data, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, kdf: 'PBKDF2-SHA256', iterations: 310000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}
async function decryptRecord(record, password) {
  if (!record || record.format !== BACKUP_FORMAT || record.version !== BACKUP_VERSION || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== 310000) throw new Error('Dosya bu uygulamayla uyumlu bir yedek değil.');
  const salt = base64ToBytes(record.salt); const iv = base64ToBytes(record.iv); const ciphertext = base64ToBytes(record.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length > 20_000_000) throw new Error('Yedek dosyası geçersiz veya çok büyük.');
  const key = await deriveKey(password, salt); const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext); const decoded = JSON.parse(decoder.decode(plaintext));
  return { data: validateData(decoded), key, salt, migrated: decoded.schema !== 3 };
}
async function persist() { const record = await encryptData(appData, cryptoKey, appData.salt); localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); }
function showToast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800); }
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function pinField(name, label) { return `<label>${label}<input class="pin-input" name="${name}" type="password" inputmode="none" autocomplete="off" minlength="4" maxlength="8" pattern="[0-9]{4,8}" readonly required></label>`; }
function pinKeypad() { return `<div class="pin-keypad" aria-label="Rakam tuş takımı"><button type="button" data-pin-key="1">1</button><button type="button" data-pin-key="2">2</button><button type="button" data-pin-key="3">3</button><button type="button" data-pin-key="4">4</button><button type="button" data-pin-key="5">5</button><button type="button" data-pin-key="6">6</button><button type="button" data-pin-key="7">7</button><button type="button" data-pin-key="8">8</button><button type="button" data-pin-key="9">9</button><span class="pin-keypad-spacer" aria-hidden="true"></span><button type="button" data-pin-key="0">0</button><button type="button" data-pin-key="backspace" aria-label="Son rakamı sil">⌫</button></div>`; }
function pinValueIsValid(value) { return /^[0-9]{4,8}$/.test(value); }
function setLocked(message = 'Notların bu cihazda şifreli saklanır.') {
  appData = null; cryptoKey = null; reauthenticatedNotes.clear(); $('mainView').hidden = true; $('lockedView').hidden = false; $('lockMessage').textContent = message;
  const exists = !!localStorage.getItem(STORAGE_KEY); $('lockTitle').textContent = exists ? 'Tekrar hoş geldin' : 'Kilit oluştur'; $('unlockButton').textContent = exists ? 'Kilidi Aç' : 'Parola Oluştur';
  $('passwordInput').value = ''; activePinInput = $('passwordInput'); $('lockError').textContent = ''; $('passwordHint').hidden = exists;
}
async function unlock(password) {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) { const salt = crypto.getRandomValues(new Uint8Array(16)); cryptoKey = await deriveKey(password, salt); appData = { ...initialData(), salt }; await persist(); }
  else { const result = await decryptRecord(JSON.parse(saved), password); appData = { ...result.data, salt: result.salt }; cryptoKey = result.key; if (result.migrated) await persist(); }
  $('passwordInput').value = ''; currentPage = 'home'; $('lockedView').hidden = true; $('mainView').hidden = false; render();
}
function todayISO() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
function dateDaysFromToday(iso) { const target = Date.parse(`${iso}T00:00:00Z`); const today = Date.parse(`${todayISO()}T00:00:00Z`); return Math.round((target - today) / 86400000); }
function formatDate(iso, year = false) { if (!iso) return ''; const date = new Date(`${iso}T12:00:00`); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) }).format(date); }
function currentNote() { return appData.notes.find((note) => note.id === currentNoteId); }
function sortedNotes(notes) { return [...notes].sort((a,b) => noteSort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt); }
function renderHome() {
  const pinned = appData.notes.find((note) => note.id === appData.pinnedNoteId);
  const center = appData.homeImageMode === 'logo' ? '<img src="./logo-default.png" alt="Seçili logo">' : appData.homeImageMode === 'custom' && appData.homeImageData ? `<img src="${appData.homeImageData}" alt="Seçilen görsel">` : '<span class="center-placeholder">✦</span>';
  $('pageContent').innerHTML = `<section class="hub-screen" aria-label="Ana menü">
    <div class="hub-rays" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <button class="sector sector-top" data-page="notes"><span class="sector-icon">▦</span><span>NOTLARIM</span></button>
    <button class="sector sector-left" data-page="upcoming"><span class="sector-icon">⌖</span><span>YAKLAŞANLAR</span></button>
    <button class="sector sector-right" data-action="open-pinned"><span class="sector-icon">${pinned ? '★' : '☆'}</span><span>${pinned ? escapeHtml(pinned.title) : 'SABİTLENMİŞ<br>NOT'}</span></button>
    <button class="sector sector-bottom" data-page="settings"><span class="sector-icon">⚙</span><span>AYARLAR</span></button>
    <div class="hub-center">${center}</div>
  </section>`;
}
function noteCard(note, compact = false) {
  const dueClass = note.dateSensitive && !note.done ? (dateDaysFromToday(note.date) < 0 ? 'overdue' : dateDaysFromToday(note.date) <= 15 ? 'urgent' : dateDaysFromToday(note.date) <= 30 ? 'soon' : '') : '';
  const dateTag = note.dateSensitive && note.date ? `<span class="note-date ${dueClass}">◷ ${escapeHtml(formatDate(note.date, true))}</span>` : '';
  const preview = note.requiresPassword ? 'İçeriği görüntülemek için tekrar parola gir' : (note.body || 'Açıklama yok');
  return `<article class="note-card ${note.done ? 'is-done' : ''} ${compact ? 'compact-note' : ''}">
    <button class="note-open" data-open-note="${note.id}"><span class="note-card-mark">${note.requiresPassword ? '▣' : '▤'}</span><strong>${escapeHtml(note.title)}</strong><span class="note-preview">${escapeHtml(preview)}</span>${dateTag}<small>${note.requiresPassword ? 'Açarken parola ister' : note.done ? 'Tamamlandı' : 'Not'}</small></button>
    <button class="note-pin ${note.id === appData.pinnedNoteId ? 'selected' : ''}" data-pin-note="${note.id}" aria-label="${note.id === appData.pinnedNoteId ? 'Sabitlemeyi kaldır' : 'Sabitlenmiş not yap'}">${note.id === appData.pinnedNoteId ? '★' : '☆'}</button>
    <button class="note-done ${note.done ? 'checked' : ''}" data-done-note="${note.id}" aria-label="${note.done ? 'Yapılmadı olarak işaretle' : 'Yapıldı olarak işaretle'}">${note.done ? '✓' : ''}</button>
  </article>`;
}
function renderNotes() {
  const query = searchQuery.trim().toLocaleLowerCase('tr');
  const notes = sortedNotes(appData.notes.filter((note) => note.title.toLocaleLowerCase('tr').includes(query)));
  $('pageContent').innerHTML = `<section class="content-screen notes-screen">
    <header class="page-header"><button class="back-button" data-page="home" aria-label="Ana menü">‹</button><div><h1>Notlarım</h1><p>${appData.notes.length} not</p></div><button class="round-add" data-action="new-note" aria-label="Not ekle">＋</button></header>
    <label class="search-box"><span>⌕</span><input id="searchInput" placeholder="Not adına göre ara" value="${escapeHtml(searchQuery)}" autocomplete="off"></label>
    <label class="sort-row"><span>Sıralama</span><select id="sortSelect"><option value="newest" ${noteSort === 'newest' ? 'selected' : ''}>En yeni önce</option><option value="oldest" ${noteSort === 'oldest' ? 'selected' : ''}>En eski önce</option></select></label>
    ${notes.length ? `<div class="notes-grid">${notes.map((note) => noteCard(note)).join('')}</div>` : `<div class="empty-state"><span>▤</span><h3>${query ? 'Not bulunamadı' : 'Henüz not yok'}</h3><p>${query ? 'Başka bir başlıkla ara.' : '＋ düğmesiyle ilk notunu oluştur.'}</p>${!query ? '<button class="primary" data-action="new-note">Not ekle</button>' : ''}</div>`}
  </section>`;
}
function renderUpcoming() {
  const dated = appData.notes.filter((note) => note.dateSensitive && note.date && !note.done);
  const notes = upcomingTab === 'overdue' ? dated.filter((note) => dateDaysFromToday(note.date) < 0).sort((a,b) => b.date.localeCompare(a.date)) : dated.filter((note) => dateDaysFromToday(note.date) >= 0).sort((a,b) => a.date.localeCompare(b.date));
  $('pageContent').innerHTML = `<section class="content-screen upcoming-screen"><header class="page-header"><button class="back-button" data-page="home" aria-label="Ana menü">‹</button><div><h1>Yaklaşanlar</h1><p>Tarihli notların</p></div><span class="header-spacer"></span></header>
    <div class="segmented"><button class="${upcomingTab === 'upcoming' ? 'selected' : ''}" data-upcoming-tab="upcoming">Yaklaşanlar</button><button class="${upcomingTab === 'overdue' ? 'selected' : ''}" data-upcoming-tab="overdue">Tarihi Geçenler</button></div>
    ${notes.length ? `<div class="upcoming-list">${notes.map((note) => noteCard(note, true)).join('')}</div>` : `<div class="empty-state"><span>${upcomingTab === 'overdue' ? '✓' : '◷'}</span><h3>${upcomingTab === 'overdue' ? 'Geçmiş tarihli not yok' : 'Yaklaşan not yok'}</h3><p>${upcomingTab === 'overdue' ? 'Tarihi geçmiş ve tamamlanmamış notların burada görünür.' : 'Tarih eklediğin notlar burada sıralanır.'}</p></div>`}
  </section>`;
}
function renderNote() {
  const note = currentNote(); if (!note) { currentPage = 'notes'; render(); return; }
  $('pageContent').innerHTML = `<section class="content-screen detail-screen"><header class="page-header"><button class="back-button" data-page="notes" aria-label="Notlara dön">‹</button><div><h1>Not</h1><p>${note.requiresPassword ? 'Parola doğrulandı' : 'Kişisel not'}</p></div><button class="round-add edit-note-button" data-action="edit-note" aria-label="Notu düzenle">···</button></header>
    <article class="note-detail"><div class="detail-topline"><span>${note.done ? 'TAMAMLANDI' : 'NOT'}</span><button class="detail-pin ${note.id === appData.pinnedNoteId ? 'selected' : ''}" data-pin-note="${note.id}">${note.id === appData.pinnedNoteId ? '★ Sabitlenmiş' : '☆ Sabitle'}</button></div><h2>${escapeHtml(note.title)}</h2>${note.dateSensitive && note.date ? `<div class="detail-date ${note.done ? '' : dueTone(note.date)}">◷ ${escapeHtml(formatDate(note.date, true))}${dateDaysFromToday(note.date) < 0 && !note.done ? ` · ${Math.abs(dateDaysFromToday(note.date))} gün geçti` : ''}</div>` : ''}<div class="note-body">${escapeHtml(note.body).replace(/\n/g,'<br>') || '<span class="muted">Açıklama eklenmemiş.</span>'}</div><button class="complete-note ${note.done ? 'completed' : ''}" data-done-note="${note.id}">${note.done ? '✓ Yapıldı' : '○ Yapıldı olarak işaretle'}</button></article>
  </section>`;
}
function dueTone(date) { const days = dateDaysFromToday(date); return days < 0 ? 'overdue' : days <= 15 ? 'urgent' : days <= 30 ? 'soon' : ''; }
function renderSettings() {
  const mode = appData.homeImageMode;
  $('pageContent').innerHTML = `<section class="content-screen settings-screen"><header class="page-header"><button class="back-button" data-page="home" aria-label="Ana menü">‹</button><div><h1>Ayarlar</h1><p>Uygulama tercihleri</p></div><span class="header-spacer"></span></header>
    <div class="settings-group"><h2>Merkez görseli</h2><p class="settings-help">Ana menünün ortasında görünecek görseli seç.</p><label class="choice-row"><input type="radio" name="imageMode" value="spark" ${mode === 'spark' ? 'checked' : ''}><span class="choice-preview spark-preview">✦</span><span><strong>Varsayılan</strong><small>Orijinal merkez simgesi</small></span></label><label class="choice-row"><input type="radio" name="imageMode" value="logo" ${mode === 'logo' ? 'checked' : ''}><span class="choice-preview logo-preview"><img src="./logo-default.png" alt="İkinci varsayılan logo"></span><span><strong>İkinci varsayılan logo</strong><small>Eklediğin logo</small></span></label><label class="choice-row"><input type="radio" name="imageMode" value="custom" ${mode === 'custom' ? 'checked' : ''}><span class="choice-preview custom-preview">＋</span><span><strong>Kendi görselim</strong><small>${appData.homeImageData ? 'Yüklediğin görsel' : 'Bir görsel yükle'}</small></span><input id="homeImageInput" type="file" accept="image/*" hidden></label><button class="secondary full-width" data-action="upload-image">Görsel yükle</button></div>
    <div class="settings-group"><h2>Güvenlik</h2><div class="settings-row static-row"><span class="settings-icon">◈</span><span><strong>Yerel ve şifreli kayıt</strong><small>Notlar bu cihazda AES-GCM ile saklanır.</small></span></div><button class="settings-row" data-action="change-password"><span class="settings-icon">⌑</span><span><strong>Uygulama parolasını değiştir</strong><small>Yeni parola en az 4 karakter olmalı</small></span><span class="settings-arrow">›</span></button></div>
    <div class="settings-group"><h2>Yedek</h2><button class="settings-row" data-action="export"><span class="settings-icon">⇧</span><span><strong>Şifreli yedeği dışa aktar</strong><small>Notlarını yedek dosyasına kaydet</small></span><span class="settings-arrow">›</span></button><label class="settings-row upload-row"><span class="settings-icon">⇩</span><span><strong>Yedekten içe aktar</strong><small>Şifreli yedek dosyasını seç</small></span><span class="settings-arrow">›</span><input id="importFile" type="file" accept=".json,application/json" hidden></label></div>
    <div class="settings-group"><h2>Uygulama</h2><div class="settings-row static-row"><span class="settings-icon">ⓘ</span><span><strong>Uygulama sürümü</strong><small>${APP_VERSION}</small></span></div><button class="settings-row" data-action="update"><span class="settings-icon">↻</span><span><strong>Güncellemeleri kontrol et</strong><small>Yalnızca sen dokunduğunda kontrol eder</small></span><span class="settings-arrow">›</span></button><button class="settings-row" data-action="lock"><span class="settings-icon">⌑</span><span><strong>Uygulamayı kilitle</strong><small>Parola ekranına dön</small></span><span class="settings-arrow">›</span></button></div>
    <p class="settings-privacy"><span class="privacy-dot"></span> Yalnızca bu cihazda saklanır</p>
  </section>`;
}
function render() {
  if (!appData) return;
  $('pageContent').className = `page-content page-${currentPage}`;
  if (currentPage === 'home') renderHome(); else if (currentPage === 'notes') renderNotes(); else if (currentPage === 'upcoming') renderUpcoming(); else if (currentPage === 'note') renderNote(); else renderSettings();
}
function openDialog(title, content) { $('dialogTitle').textContent = title; $('dialogBody').innerHTML = content; $('appDialog').showModal(); }
function closeDialog() { $('appDialog').close(); }
function saveAndRender() { persist().then(render).catch(() => showToast('Kaydetme başarısız. Cihazda boş alan olduğundan emin ol.')); }
function showNoteForm(note = null) {
  const editing = !!note;
  openDialog(editing ? 'Notu düzenle' : 'Yeni not', `<form id="noteForm" class="dialog-form"><label>Not başlığı<input name="title" maxlength="120" required value="${escapeHtml(note?.title || '')}" placeholder="Notun başlığı"></label><label>Açıklama<textarea name="body" maxlength="12000" rows="6" placeholder="Notunu yaz…">${escapeHtml(note?.body || '')}</textarea></label><label class="check-label"><input name="dateSensitive" type="checkbox" ${note?.dateSensitive ? 'checked' : ''}> Bu not tarih duyarlı</label><label id="noteDateField" class="${note?.dateSensitive ? '' : 'hidden-field'}">Tarih<input name="date" type="date" value="${escapeHtml(note?.date || '')}" ${note?.dateSensitive ? 'required' : ''}></label><label class="check-label"><input name="requiresPassword" type="checkbox" ${note?.requiresPassword ? 'checked' : ''}> Bu nota girerken tekrar uygulama parolası sor</label><div class="dialog-actions">${editing ? `<button type="button" class="text-button danger-text" data-delete-note="${note.id}">Notu sil</button><span></span>` : ''}<button type="button" class="secondary" data-close-dialog>Vazgeç</button><button class="primary" type="submit">${editing ? 'Kaydet' : 'Not ekle'}</button></div></form>`);
  const form = $('noteForm');
  form.querySelector('[name="dateSensitive"]').addEventListener('change', (event) => { const label = $('noteDateField'); const field = label.querySelector('input'); label.classList.toggle('hidden-field', !event.target.checked); field.required = event.target.checked; if (!event.target.checked) field.value = ''; });
  form.addEventListener('submit', (event) => { event.preventDefault(); const fd = new FormData(form); const dateSensitive = fd.has('dateSensitive'); const values = { title: String(fd.get('title')).trim(), body: String(fd.get('body') || '').trim(), dateSensitive, date: dateSensitive ? String(fd.get('date') || '') : '', requiresPassword: fd.has('requiresPassword') };
    if (editing) Object.assign(note, values); else appData.notes.push({ id: makeId(), ...values, done: false, createdAt: Date.now(), pinned: false });
    searchQuery = ''; closeDialog(); saveAndRender();
  });
}
function requestNotePassword(note) {
  openDialog('Parola gerekli', `<form id="noteUnlockForm" class="dialog-form"><p class="dialog-copy">Bu notu açmak için uygulama parolanı tekrar gir.</p>${pinField('password', 'Uygulama parolası')}${pinKeypad()}<p id="noteUnlockError" class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-close-dialog>Vazgeç</button><button class="primary" type="submit">Notu aç</button></div></form>`);
  activePinInput = $('noteUnlockForm').elements.password;
  $('noteUnlockForm').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const password = String(new FormData(form).get('password') || ''); try { await decryptRecord(JSON.parse(localStorage.getItem(STORAGE_KEY)), password); form.reset(); reauthenticatedNotes.add(note.id); closeDialog(); currentNoteId = note.id; currentPage = 'note'; render(); } catch { $('noteUnlockError').textContent = 'Parola yanlış.'; } });
}
function openNote(id) { const note = appData.notes.find((item) => item.id === id); if (!note) return; if (note.requiresPassword && !reauthenticatedNotes.has(note.id)) requestNotePassword(note); else { currentNoteId = note.id; currentPage = 'note'; render(); } }
function showPasswordChange() {
  openDialog('Parolayı değiştir', `<form id="changePasswordForm" class="dialog-form"><div class="pin-fields">${pinField('current', 'Mevcut parola')}${pinField('next', 'Yeni parola')}${pinField('confirm', 'Yeni parola tekrar')}</div>${pinKeypad()}<p id="passwordChangeError" class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-close-dialog>Vazgeç</button><button class="primary" type="submit">Parolayı değiştir</button></div></form>`);
  activePinInput = $('changePasswordForm').elements.current;
  $('changePasswordForm').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const current = String(fd.get('current')); const next = String(fd.get('next')); const confirmNext = String(fd.get('confirm')); const error = $('passwordChangeError'); error.textContent = ''; if (![current, next, confirmNext].every(pinValueIsValid)) { error.textContent = 'Her parola 4–8 rakamdan oluşmalı.'; return; } if (next !== confirmNext) { error.textContent = 'Yeni parolalar eşleşmiyor.'; return; }
    try { await decryptRecord(JSON.parse(localStorage.getItem(STORAGE_KEY)), current); const salt = crypto.getRandomValues(new Uint8Array(16)); const nextKey = await deriveKey(next, salt); const record = await encryptData(appData, nextKey, salt); localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); appData.salt = salt; cryptoKey = nextKey; form.reset(); closeDialog(); showToast('Uygulama parolası değiştirildi.'); }
    catch { error.textContent = 'Mevcut parola yanlış veya değişiklik kaydedilemedi.'; }
  });
}
function downloadBackup(record) { const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `notlarim-yedek-${new Date().toISOString().slice(0,10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function exportBackup() { try { downloadBackup(await encryptData(appData, cryptoKey, appData.salt)); showToast('Şifreli yedek dosyası hazır.'); } catch { showToast('Yedek oluşturulamadı.'); } }
async function onImportSelected(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 20_000_000) { showToast('Yedek dosyası çok büyük.'); return; }
  openDialog('Yedekten içe aktar', `<form id="importBackupForm" class="dialog-form">${pinField('password', 'Yedek parolası')}${pinKeypad()}<p class="dialog-copy">İçe aktarma mevcut notlarının yerine geçer.</p><label class="check-label"><input name="replace" type="checkbox" required> Mevcut verilerin yerine aktarmayı onaylıyorum</label><p id="importError" class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-close-dialog>Vazgeç</button><button class="primary" type="submit">Yedeği yükle</button></div></form>`);
  activePinInput = $('importBackupForm').elements.password;
  $('importBackupForm').addEventListener('submit', async (submitEvent) => { submitEvent.preventDefault(); try { const pass = String(new FormData(submitEvent.currentTarget).get('password') || ''); const restored = await decryptRecord(JSON.parse(await file.text()), pass); appData = { ...restored.data, salt: appData.salt }; currentPage = 'notes'; closeDialog(); await persist(); render(); showToast('Yedek aktarıldı.'); } catch { $('importError').textContent = 'Yedek açılamadı. Parolayı ve dosyayı kontrol et.'; } });
}
async function onImageSelected(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) { if (appData.homeImageMode === 'custom' && !appData.homeImageData) { appData.homeImageMode = previousImageMode; render(); } return; } if (!file.type.startsWith('image/') || file.size > 1_500_000) { if (appData.homeImageMode === 'custom' && !appData.homeImageData) { appData.homeImageMode = previousImageMode; render(); } showToast('1,5 MB’dan küçük bir görsel seç.'); return; } const reader = new FileReader(); reader.onload = async () => { appData.homeImageData = String(reader.result); appData.homeImageMode = 'custom'; await persist(); render(); showToast('Merkez görseli kaydedildi.'); }; reader.readAsDataURL(file); }
async function checkForUpdate() { if (!('serviceWorker' in navigator)) { showToast('Bu tarayıcı güncelleme kontrolünü desteklemiyor.'); return; } try { const registration = await navigator.serviceWorker.getRegistration(); if (!registration) { showToast('Çevrim dışı uygulama henüz hazır değil.'); return; } await registration.update(); showToast(registration.waiting || registration.installing ? 'Yeni sürüm bulundu; uygulamayı kapatıp açınca yüklenir.' : 'Uygulama güncel.'); } catch { showToast('Kontrol edilemedi. Kayıtlı sürüm çalışmaya devam ediyor.'); } }

$('unlockForm').addEventListener('submit', async (event) => { event.preventDefault(); const password = $('passwordInput').value; $('lockError').textContent = ''; if (!pinValueIsValid(password)) { $('lockError').textContent = 'Parola 4–8 rakamdan oluşmalı.'; return; } try { await unlock(password); } catch { cryptoKey = null; appData = null; $('lockError').textContent = 'Parola yanlış veya yedek verisi açılamadı.'; $('passwordInput').select(); } });
document.addEventListener('click', (event) => {
  const input = event.target.closest('.pin-input');
  if (input) { activePinInput = input; return; }
  const key = event.target.closest('[data-pin-key]');
  if (!key || !activePinInput?.isConnected) return;
  const value = activePinInput.value;
  if (key.dataset.pinKey === 'backspace') activePinInput.value = value.slice(0, -1);
  else if (/^\d$/.test(key.dataset.pinKey) && value.length < 8) activePinInput.value = value + key.dataset.pinKey;
  activePinInput.dispatchEvent(new Event('input', { bubbles: true }));
});
$('mainView').addEventListener('input', (event) => { if (event.target.id !== 'searchInput') return; searchQuery = event.target.value; const pos = event.target.selectionStart; renderNotes(); const input = $('searchInput'); input.focus(); input.setSelectionRange(pos, pos); });
$('mainView').addEventListener('change', (event) => {
  if (event.target.id === 'sortSelect') { noteSort = event.target.value; renderNotes(); }
  if (event.target.name === 'imageMode') { const nextMode = event.target.value; previousImageMode = appData.homeImageMode; appData.homeImageMode = nextMode; if (nextMode === 'custom' && !appData.homeImageData) { $('homeImageInput')?.click(); } else saveAndRender(); }
  if (event.target.id === 'homeImageInput') onImageSelected(event);
  if (event.target.id === 'importFile') onImportSelected(event);
});
$('mainView').addEventListener('click', async (event) => {
  const target = event.target.closest('button, label'); if (!target) return;
  if (target.dataset.page) { if (currentPage === 'note') { const note = currentNote(); if (note?.requiresPassword) reauthenticatedNotes.delete(note.id); } currentPage = target.dataset.page; searchQuery = ''; render(); return; }
  if (target.dataset.action === 'new-note') { showNoteForm(); return; }
  if (target.dataset.action === 'edit-note') { showNoteForm(currentNote()); return; }
  if (target.dataset.action === 'open-pinned') { const note = appData.notes.find((item) => item.id === appData.pinnedNoteId); if (note) openNote(note.id); else { currentPage = 'notes'; render(); showToast('Önce bir notu sabitle.'); } return; }
  if (target.dataset.action === 'upload-image') { $('homeImageInput').click(); return; }
  if (target.dataset.action === 'change-password') { showPasswordChange(); return; }
  if (target.dataset.action === 'export') { await exportBackup(); return; }
  if (target.dataset.action === 'update') { await checkForUpdate(); return; }
  if (target.dataset.action === 'lock') { setLocked('Uygulama kilitlendi. Notların cihazında şifreli kalır.'); return; }
  if (target.dataset.openNote) { openNote(target.dataset.openNote); return; }
  if (target.dataset.upcomingTab) { upcomingTab = target.dataset.upcomingTab; renderUpcoming(); return; }
  if (target.dataset.pinNote) { const id = target.dataset.pinNote; appData.pinnedNoteId = appData.pinnedNoteId === id ? null : id; appData.notes.forEach((note) => { note.pinned = note.id === appData.pinnedNoteId; }); saveAndRender(); return; }
  if (target.dataset.doneNote) { const note = appData.notes.find((item) => item.id === target.dataset.doneNote); if (note) note.done = !note.done; saveAndRender(); return; }
  if (target.dataset.deleteNote) { appData.notes = appData.notes.filter((note) => note.id !== target.dataset.deleteNote); if (appData.pinnedNoteId === target.dataset.deleteNote) appData.pinnedNoteId = null; reauthenticatedNotes.delete(target.dataset.deleteNote); currentNoteId = null; currentPage = 'notes'; closeDialog(); saveAndRender(); return; }
});
$('dialogBody').addEventListener('click', (event) => { if (event.target.closest('[data-close-dialog]')) { closeDialog(); return; } const remove = event.target.closest('[data-delete-note]'); if (remove) { appData.notes = appData.notes.filter((note) => note.id !== remove.dataset.deleteNote); if (appData.pinnedNoteId === remove.dataset.deleteNote) appData.pinnedNoteId = null; reauthenticatedNotes.delete(remove.dataset.deleteNote); currentNoteId = null; currentPage = 'notes'; closeDialog(); saveAndRender(); } });
if (!window.crypto?.subtle || !window.isSecureContext) { $('lockedView').hidden = false; $('lockTitle').textContent = 'Güvenli bağlantı gerekli'; $('lockMessage').textContent = 'Şifreleme için uygulamayı HTTPS üzerinden açmalısın.'; $('unlockForm').hidden = true; } else setLocked();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
