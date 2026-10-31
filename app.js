const STORAGE_KEY = 'cep-listem.encrypted.v1';
const BACKUP_FORMAT = 'cep-listem-backup';
const BACKUP_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (id) => document.getElementById(id);
let cryptoKey = null;
let appData = null;
let currentPage = 'home';
let currentMenuId = null;
let menuFilter = 'all';
let eventFilter = 'all';
let currentQuery = '';
let toastTimer;

const menuTypes = {
  subscriptions: { label: 'Abonelikler', icon: '▤', singular: 'abonelik' },
  tasks: { label: 'Yapılacaklar', icon: '✓', singular: 'görev' },
  notes: { label: 'Notlar', icon: '▧', singular: 'not' },
  movies: { label: 'İzlenecekler', icon: '▷', singular: 'içerik' },
  custom: { label: 'Özel menü', icon: '◇', singular: 'kayıt' }
};

function bytesToBase64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function initialData() {
  const menus = [
    { id: makeId(), name: 'Abonelikler', type: 'subscriptions', items: [] },
    { id: makeId(), name: 'Yapılacaklar', type: 'tasks', items: [] },
    { id: makeId(), name: 'Notlar', type: 'notes', items: [] },
    { id: makeId(), name: 'İzlenecekler', type: 'movies', items: [] }
  ];
  return { schema: 2, menus, pinned: [], homeImage: '', activeMenuId: menus[0].id };
}
function validateData(value) {
  if (!value || (value.schema !== 1 && value.schema !== 2)) throw new Error('Yedek dosyasının biçimi geçerli değil.');
  if (value.schema === 1) {
    if (!Array.isArray(value.lists)) throw new Error('Yedek dosyasındaki listeler geçersiz.');
    const menus = value.lists.slice(0, 100).map((list) => ({
      id: String(list.id || makeId()).slice(0, 100), name: String(list.name || 'Yapılacaklar').slice(0, 50), type: 'tasks',
      items: Array.isArray(list.tasks) ? list.tasks.slice(0, 10000).map((task) => ({ id: String(task.id || makeId()).slice(0, 100), title: String(task.text || '').slice(0, 180), details: '', done: !!task.done, createdAt: Number(task.createdAt) || Date.now(), pinned: false })) : []
    }));
    if (!menus.length) menus.push({ id: makeId(), name: 'Yapılacaklar', type: 'tasks', items: [] });
    return { schema: 2, menus, pinned: [], homeImage: '', activeMenuId: menus[0].id };
  }
  if (!Array.isArray(value.menus) || value.menus.length > 100) throw new Error('Yedek dosyasındaki menüler geçersiz.');
  const menus = value.menus.map((menu) => {
    if (!menu || typeof menu.id !== 'string' || typeof menu.name !== 'string' || !Array.isArray(menu.items) || menu.items.length > 10000) throw new Error('Yedek dosyasındaki menü bilgileri geçersiz.');
    const type = Object.prototype.hasOwnProperty.call(menuTypes, menu.type) ? menu.type : 'custom';
    return { id: menu.id.slice(0, 100), name: menu.name.slice(0, 50), type, items: menu.items.map((item) => {
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') throw new Error('Yedek dosyasındaki kayıt bilgileri geçersiz.');
      return { id: item.id.slice(0, 100), title: item.title.slice(0, 160), details: String(item.details || '').slice(0, 1000), amount: String(item.amount || '').slice(0, 30), period: String(item.period || 'ay').slice(0, 20), date: String(item.date || '').slice(0, 30), status: item.status === 'cancelled' ? 'cancelled' : 'active', done: !!item.done, pinned: !!item.pinned, createdAt: Number(item.createdAt) || Date.now() };
    }) };
  });
  return { schema: 2, menus, pinned: Array.isArray(value.pinned) ? value.pinned.filter((id) => typeof id === 'string').slice(0, 10000) : [], homeImage: typeof value.homeImage === 'string' && value.homeImage.length < 2_500_000 ? value.homeImage : '', activeMenuId: menus.some((menu) => menu.id === value.activeMenuId) ? value.activeMenuId : (menus[0]?.id || null) };
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
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length > 12_000_000) throw new Error('Yedek dosyası geçersiz veya çok büyük.');
  const key = await deriveKey(password, salt); const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return { data: validateData(JSON.parse(decoder.decode(plaintext))), key, salt };
}
async function persist() { const record = await encryptData(appData, cryptoKey, appData.salt); localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); }
function showToast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800); }
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function setLocked(message = 'Kayıtların bu cihazda şifreli saklanır.') {
  appData = null; cryptoKey = null; $('mainView').hidden = true; $('lockedView').hidden = false; $('lockMessage').textContent = message;
  const exists = !!localStorage.getItem(STORAGE_KEY); $('lockTitle').textContent = exists ? 'Tekrar hoş geldin' : 'Kilit oluştur'; $('unlockButton').textContent = exists ? 'Kilidi Aç' : 'Parola Oluştur';
  $('passwordInput').autocomplete = exists ? 'current-password' : 'new-password'; $('passwordInput').value = ''; $('lockError').textContent = ''; $('passwordHint').hidden = exists; setTimeout(() => $('passwordInput').focus(), 50);
}
async function unlock(password) {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) { const salt = crypto.getRandomValues(new Uint8Array(16)); cryptoKey = await deriveKey(password, salt); appData = { ...initialData(), salt }; await persist(); }
  else { const result = await decryptRecord(JSON.parse(saved), password); appData = { ...result.data, salt: result.salt }; cryptoKey = result.key; await persist(); }
  currentPage = 'home'; $('lockedView').hidden = true; $('mainView').hidden = false; render();
}
function currentMenu() { return appData.menus.find((menu) => menu.id === currentMenuId); }
function openMenu(id) { currentMenuId = id; appData.activeMenuId = id; currentPage = 'menu'; currentQuery = ''; eventFilter = 'all'; persist().then(render); }
function goHome() { currentPage = 'home'; render(); }
function goMenus() { currentPage = 'menus'; render(); }
function goPinned() { currentPage = 'pinned'; render(); }
function goSettings() { currentPage = 'settings'; render(); }
function renderHome() {
  $('pageContent').innerHTML = `<section class="hub-screen" aria-label="Ana menü">
    <button class="sector sector-top" data-page="menus"><span class="sector-icon">▦</span><span>OLAYLAR</span></button>
    <button class="sector sector-left" data-page="pinned"><span class="sector-icon">⌖</span><span>SABİTLENMİŞ<br>OLAY</span></button>
    <button class="sector sector-right" data-action="new-menu"><span class="sector-icon">＋</span><span>YENİ MENÜ<br>OLUŞTUR</span></button>
    <button class="sector sector-bottom" data-page="settings"><span class="sector-icon">⚙</span><span>AYARLAR</span></button>
    <button class="hub-center" data-page="settings" aria-label="Merkez görselini ayarlardan değiştir">${appData.homeImage ? `<img src="${appData.homeImage}" alt="Seçilen merkez görseli">` : '<span class="center-placeholder">✦</span>'}</button>
    <div class="hub-rays" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  </section>`;
}
function renderMenus() {
  const query = currentQuery.trim().toLocaleLowerCase('tr');
  const visible = appData.menus.filter((menu) => (menuFilter === 'all' || menu.type === menuFilter) && menu.name.toLocaleLowerCase('tr').includes(query));
  $('pageContent').innerHTML = `<section class="content-screen">
    <header class="page-header"><button class="back-button" data-page="home" aria-label="Geri">‹</button><div><h1>Menüler</h1><p>Oluşturduğun alanlar</p></div><button class="round-add" data-action="new-menu" aria-label="Yeni menü">＋</button></header>
    <label class="search-box"><span>⌕</span><input id="searchInput" placeholder="Menülerde ara" value="${escapeHtml(currentQuery)}" autocomplete="off"></label>
    <div class="chip-row">${[['all','Tümü'],['subscriptions','Abonelik'],['tasks','Görev'],['notes','Not'],['movies','İzlenecek'],['custom','Özel']].map(([key,label]) => `<button class="filter-chip ${menuFilter === key ? 'selected' : ''}" data-menu-filter="${key}">${label}</button>`).join('')}</div>
    ${visible.length ? `<div class="menu-grid">${visible.map((menu) => `<button class="menu-tile type-${menu.type}" data-open-menu="${menu.id}"><span class="tile-menu-icon">${menuTypes[menu.type].icon}</span><span class="tile-title">${escapeHtml(menu.name)}</span><span class="tile-meta">${menu.items.length} kayıt</span><span class="tile-arrow">›</span></button>`).join('')}<button class="menu-tile add-tile" data-action="new-menu"><span class="tile-menu-icon">＋</span><span class="tile-title">Yeni menü</span><span class="tile-meta">Kendi alanını oluştur</span></button></div>` : `<div class="empty-state"><span>✦</span><h3>Henüz menü yok</h3><p>Yeni menü oluşturarak başlayabilirsin.</p><button class="primary" data-action="new-menu">Menü oluştur</button></div>`}
  </section>`;
}
function itemDate(item) { if (!item.date) return ''; const date = new Date(`${item.date}T12:00:00`); return Number.isNaN(date.getTime()) ? item.date : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(date); }
function renderMenu() {
  const menu = currentMenu(); if (!menu) { currentPage = 'menus'; render(); return; }
  const info = menuTypes[menu.type]; const query = currentQuery.trim().toLocaleLowerCase('tr');
  let items = menu.items.filter((item) => `${item.title} ${item.details}`.toLocaleLowerCase('tr').includes(query));
  if (menu.type === 'subscriptions' && eventFilter !== 'all') items = items.filter((item) => item.status === eventFilter);
  const totalMonthly = menu.items.filter((item) => item.status !== 'cancelled').reduce((sum,item) => sum + (Number(item.amount) || 0) / (item.period === 'yıl' ? 12 : item.period === 'hafta' ? 0.23 : 1), 0);
  const filters = menu.type === 'subscriptions' ? `<div class="chip-row">${[['all','Tümü'],['active','Aktif'],['cancelled','İptal edildi']].map(([key,label]) => `<button class="filter-chip ${eventFilter === key ? 'selected' : ''}" data-event-filter="${key}">${label}</button>`).join('')}</div>` : '';
  $('pageContent').innerHTML = `<section class="content-screen">
    <header class="page-header"><button class="back-button" data-page="menus" aria-label="Menülere dön">‹</button><div><h1>${escapeHtml(menu.name)}</h1><p>${menu.items.length} ${info.singular} kaydı</p></div><button class="round-add" data-action="new-item" aria-label="Yeni kayıt">＋</button></header>
    <label class="search-box"><span>⌕</span><input id="searchInput" placeholder="${escapeHtml(menu.name)} içinde ara" value="${escapeHtml(currentQuery)}" autocomplete="off"></label>
    ${menu.type === 'subscriptions' ? `<div class="subscription-summary"><div class="summary-symbol">↗</div><div><span>Aylık toplam</span><strong>₺${totalMonthly.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><small>${menu.items.filter(item => item.status !== 'cancelled').length} aktif abonelik</small></div></div>` : ''}
    ${filters}
    ${items.length ? (menu.type === 'subscriptions' ? `<div class="subscription-list">${items.map(subscriptionCard).join('')}</div>` : `<div class="event-grid">${items.map(itemCard).join('')}</div>`) : `<div class="empty-state"><span>${info.icon}</span><h3>${query ? 'Sonuç bulunamadı' : `Henüz ${info.singular} yok`}</h3><p>${query ? 'Arama sözcüğünü değiştirebilirsin.' : '＋ düğmesine dokunarak ilk kaydını ekle.'}</p>${!query ? `<button class="primary" data-action="new-item">${info.singular} ekle</button>` : ''}</div>`}
    <div class="menu-actions"><button class="text-button" data-action="pin-menu">${appData.pinned.includes(`menu:${menu.id}`) ? '★ Menü sabitlendi' : '☆ Menüyü sabitle'}</button><button class="text-button danger-text" data-action="delete-menu">Menüyü sil</button></div>
  </section>`;
}
function subscriptionCard(item) {
  const period = item.period || 'ay'; const amount = Number(item.amount) || 0; const status = item.status === 'cancelled' ? 'İptal edildi' : 'Aktif';
  return `<article class="subscription-card"><div class="service-icon ${serviceClass(item.title)}">${serviceMark(item.title)}</div><div class="subscription-info"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.details || 'Abonelik')}</span><small>◷ ${item.date ? `${escapeHtml(itemDate(item))} tarihinde yenilenir` : 'Yenileme tarihi eklenmedi'}</small></div><div class="subscription-price"><strong>₺${amount.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><span>/ ${escapeHtml(period)}</span><em class="status ${item.status === 'cancelled' ? 'cancelled' : ''}">${status}</em><button class="more-button" data-item-menu="${item.id}" aria-label="Kayıt seçenekleri">•••</button></div><button class="pin-item" data-pin-item="${item.id}" aria-label="Sabitle">${item.pinned ? '★' : '☆'}</button></article>`;
}
function serviceClass(title) { const key = title.toLocaleLowerCase('tr'); return key.includes('netflix') ? 'netflix' : key.includes('spotify') ? 'spotify' : key.includes('icloud') ? 'icloud' : key.includes('youtube') ? 'youtube' : key.includes('canva') ? 'canva' : 'generic'; }
function serviceMark(title) { const key = title.toLocaleLowerCase('tr'); return key.includes('netflix') ? 'N' : key.includes('spotify') ? '≋' : key.includes('icloud') ? '☁' : key.includes('youtube') ? '▶' : key.includes('canva') ? 'C' : '◌'; }
function itemCard(item) {
  const menu = currentMenu(); const icon = menu.type === 'tasks' ? (item.done ? '✓' : '○') : menu.type === 'movies' ? '▷' : menu.type === 'notes' ? '▧' : '◇';
  return `<article class="event-card ${item.done ? 'completed' : ''}"><button class="pin-item card-pin" data-pin-item="${item.id}" aria-label="Sabitle">${item.pinned ? '★' : '☆'}</button><button class="event-card-main" data-item-menu="${item.id}"><span class="event-symbol">${icon}</span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.details || (item.date ? itemDate(item) : menuTypes[menu.type].singular))}</span></button>${menu.type === 'tasks' ? `<button class="task-toggle ${item.done ? 'checked' : ''}" data-toggle-task="${item.id}" aria-label="Görevi tamamla">${item.done ? '✓' : ''}</button>` : ''}</article>`;
}
function renderPinned() {
  const records = [];
  for (const menu of appData.menus) for (const item of menu.items) if (item.pinned || appData.pinned.includes(item.id)) records.push({ menu, item });
  const pinnedMenus = appData.menus.filter((menu) => appData.pinned.includes(`menu:${menu.id}`));
  const hasPinned = records.length || pinnedMenus.length;
  $('pageContent').innerHTML = `<section class="content-screen"><header class="page-header"><button class="back-button" data-page="home" aria-label="Geri">‹</button><div><h1>Sabitlenmiş</h1><p>Hızlı erişim kayıtların</p></div></header>${hasPinned ? `<div class="event-grid">${pinnedMenus.map((menu) => `<button class="menu-tile pinned-tile" data-open-menu="${menu.id}"><span class="tile-menu-icon">★</span><span class="tile-title">${escapeHtml(menu.name)}</span><span class="tile-meta">Menü · ${menu.items.length} kayıt</span></button>`).join('')}${records.map(({menu,item}) => `<button class="menu-tile pinned-tile" data-open-menu="${menu.id}"><span class="tile-menu-icon">★</span><span class="tile-title">${escapeHtml(item.title)}</span><span class="tile-meta">${escapeHtml(menu.name)}</span></button>`).join('')}</div>` : `<div class="empty-state"><span>☆</span><h3>Henüz sabitlenmiş kayıt yok</h3><p>Menülerin içinden kayıtları sabitleyebilirsin.</p><button class="primary" data-page="menus">Menülere git</button></div>`}</section>`;
}
function renderSettings() {
  $('pageContent').innerHTML = `<section class="content-screen settings-screen"><header class="page-header"><button class="back-button" data-page="home" aria-label="Geri">‹</button><div><h1>Ayarlar</h1><p>Uygulamanı kişiselleştir</p></div></header>
    <div class="settings-group"><h2>Görünüm</h2><label class="settings-row upload-row"><span class="settings-icon">▧</span><span><strong>Ana ekran görseli</strong><small>Ortadaki dairede görünecek fotoğrafı seç</small></span><span class="settings-arrow">›</span><input id="homeImageInput" type="file" accept="image/*" hidden></label><button class="settings-row" data-action="remove-image"><span class="settings-icon">×</span><span><strong>Görseli kaldır</strong><small>Varsayılan simgeye dön</small></span><span class="settings-arrow">›</span></button></div>
    <div class="settings-group"><h2>Gizlilik ve yedek</h2><div class="settings-row static-row"><span class="settings-icon">◈</span><span><strong>Yerel ve şifreli kayıt</strong><small>Veriler bu cihazda AES-GCM ile şifrelenir.</small></span></div><button class="settings-row" data-action="export"><span class="settings-icon">⇧</span><span><strong>Şifreli yedeği dışa aktar</strong><small>Yedeği güvenli bir yere kaydet</small></span><span class="settings-arrow">›</span></button><label class="settings-row upload-row"><span class="settings-icon">⇩</span><span><strong>Yedekten içe aktar</strong><small>Şifreli yedek dosyasını seç</small></span><span class="settings-arrow">›</span><input id="importFile" type="file" accept=".json,application/json" hidden></label></div>
    <div class="settings-group"><h2>Uygulama</h2><button class="settings-row" data-action="update"><span class="settings-icon">↻</span><span><strong>Güncellemeleri kontrol et</strong><small>Yalnızca sen dokunduğunda kontrol eder</small></span><span class="settings-arrow">›</span></button><button class="settings-row" data-action="lock"><span class="settings-icon">⌑</span><span><strong>Uygulamayı kilitle</strong><small>Parola ekranına dön</small></span><span class="settings-arrow">›</span></button></div>
  </section>`;
}
function render() {
  if (!appData) return;
  $('pageContent').className = `page-content page-${currentPage}`;
  if (currentPage === 'home') renderHome(); else if (currentPage === 'menus') renderMenus(); else if (currentPage === 'menu') renderMenu(); else if (currentPage === 'pinned') renderPinned(); else renderSettings();
}
function openDialog(title, content) { $('dialogTitle').textContent = title; $('dialogBody').innerHTML = content; $('appDialog').showModal(); }
function closeDialog() { $('appDialog').close(); }
function showNewMenu() {
  openDialog('Yeni menü oluştur', `<form id="newMenuForm" class="dialog-form"><label>Menü adı<input name="name" maxlength="50" required placeholder="Örn. Abonelikler"></label><label>Menü türü<select name="type"><option value="subscriptions">Abonelikler</option><option value="tasks">Yapılacaklar</option><option value="notes">Notlar</option><option value="movies">İzlenecekler</option><option value="custom">Özel menü</option></select></label><div class="dialog-actions"><button type="button" class="secondary" data-close-dialog>Vazgeç</button><button class="primary" type="submit">Oluştur</button></div></form>`);
  $('newMenuForm').addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name')).trim(); if (!name) return; if (appData.menus.some((menu) => menu.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { showToast('Bu isimde bir menü zaten var.'); return; } const type = String(form.get('type')); const menu = { id: makeId(), name, type: Object.prototype.hasOwnProperty.call(menuTypes,type) ? type : 'custom', items: [] }; appData.menus.push(menu); currentMenuId = menu.id; currentPage = 'menu'; currentQuery = ''; closeDialog(); saveAndRender(); });
}
function showNewItem() {
  const menu = currentMenu(); if (!menu) return; const isSub = menu.type === 'subscriptions';
  const form = `<form id="newItemForm" class="dialog-form"><label>${isSub ? 'Abonelik adı' : 'Başlık'}<input name="title" maxlength="160" required placeholder="${isSub ? 'Örn. Netflix' : 'Kayıt adı'}"></label>${isSub ? `<label>Ücret<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></label><label>Ödeme aralığı<select name="period"><option>ay</option><option>yıl</option><option>hafta</option></select></label><label>Yenileme tarihi<input name="date" type="date"></label><label>Kategori<input name="details" maxlength="100" placeholder="Eğlence, müzik…"></label><label class="check-label"><input name="active" type="checkbox" checked> Aktif abonelik</label>` : `${menu.type === 'tasks' ? `<label>Son tarih<input name="date" type="date"></label>` : ''}${menu.type === 'movies' ? `<label>Tür / yıl<input name="details" maxlength="160" placeholder="Film · 2026"></label>` : `<label>Açıklama<textarea name="details" maxlength="500" rows="3" placeholder="İsteğe bağlı ayrıntı"></textarea></label>`}` }<div class="dialog-actions"><button type="button" class="secondary" data-close-dialog>Vazgeç</button><button class="primary" type="submit">Kaydet</button></div></form>`;
  openDialog(isSub ? 'Abonelik ekle' : `${menuTypes[menu.type].singular} ekle`, form);
  $('newItemForm').addEventListener('submit', (event) => { event.preventDefault(); const fd = new FormData(event.currentTarget); const title = String(fd.get('title')).trim(); if (!title) return; menu.items.unshift({ id: makeId(), title, details: String(fd.get('details') || '').trim(), amount: String(fd.get('amount') || ''), period: String(fd.get('period') || 'ay'), date: String(fd.get('date') || ''), status: fd.has('active') ? 'active' : (isSub ? 'cancelled' : 'active'), done: false, pinned: false, createdAt: Date.now() }); currentQuery = ''; closeDialog(); saveAndRender(); });
}
function saveAndRender() { persist().then(render).catch(() => showToast('Kaydetme başarısız. Cihazda boş alan olduğundan emin ol.')); }
function downloadBackup(record) { const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `cep-listem-yedek-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function exportBackup() { try { downloadBackup(await encryptData(appData, cryptoKey, appData.salt)); showToast('Şifreli yedek dosyası hazır.'); } catch { showToast('Yedek oluşturulamadı.'); } }
async function onImportSelected(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 12_000_000) { showToast('Yedek dosyası çok büyük.'); return; } const password = prompt('Yedek dosyasının parolasını gir:'); if (password === null) return; try { const restored = await decryptRecord(JSON.parse(await file.text()), password); if (!confirm(`Yedekte ${restored.data.menus.length} menü var. Mevcut cihaz verilerinin yerine yüklensin mi?`)) return; appData = { ...restored.data, salt: appData.salt }; currentPage = 'home'; await persist(); render(); showToast('Yedek bu cihaza aktarıldı.'); } catch { showToast('Yedek açılamadı. Parolayı ve dosyayı kontrol et.'); } }
async function onImageSelected(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (!file.type.startsWith('image/') || file.size > 1_500_000) { showToast('1,5 MB’dan küçük bir görsel seç.'); return; } const reader = new FileReader(); reader.onload = async () => { appData.homeImage = String(reader.result); await persist(); render(); showToast('Ana ekran görseli kaydedildi.'); }; reader.readAsDataURL(file); }
async function checkForUpdate() { if (!('serviceWorker' in navigator)) { showToast('Bu tarayıcı güncelleme kontrolünü desteklemiyor.'); return; } try { const reg = await navigator.serviceWorker.getRegistration(); if (!reg) { showToast('Çevrim dışı uygulama henüz hazır değil.'); return; } await reg.update(); showToast(reg.waiting || reg.installing ? 'Yeni sürüm bulundu; uygulamayı kapatıp açınca yüklenir.' : 'Uygulama güncel.'); } catch { showToast('Kontrol edilemedi. Kayıtlı sürüm çalışmaya devam ediyor.'); } }

$('unlockForm').addEventListener('submit', async (event) => { event.preventDefault(); const password = $('passwordInput').value; $('lockError').textContent = ''; if (password.length < 8) { $('lockError').textContent = 'Parola en az 8 karakter olmalı.'; return; } try { await unlock(password); } catch { cryptoKey = null; appData = null; $('lockError').textContent = 'Parola yanlış veya yedek verisi açılamadı.'; $('passwordInput').select(); } });
$('mainView').addEventListener('input', (event) => { if (event.target.id !== 'searchInput') return; currentQuery = event.target.value; const position = event.target.selectionStart; if (currentPage === 'menus') renderMenus(); else if (currentPage === 'menu') renderMenu(); const updated = $('searchInput'); updated.focus(); updated.setSelectionRange(position, position); });
$('mainView').addEventListener('click', async (event) => {
  const target = event.target.closest('button, label'); if (!target) return;
  if (target.dataset.page) { currentPage = target.dataset.page; currentQuery = ''; render(); return; }
  if (target.dataset.action === 'new-menu') { showNewMenu(); return; }
  if (target.dataset.openMenu) { openMenu(target.dataset.openMenu); return; }
  if (target.dataset.menuFilter) { menuFilter = target.dataset.menuFilter; renderMenus(); return; }
  if (target.dataset.eventFilter) { eventFilter = target.dataset.eventFilter; renderMenu(); return; }
  if (target.dataset.action === 'new-item') { showNewItem(); return; }
  if (target.dataset.action === 'export') { await exportBackup(); return; }
  if (target.dataset.action === 'update') { await checkForUpdate(); return; }
  if (target.dataset.action === 'lock') { setLocked('Uygulama kilitlendi. Kayıtların cihazında şifreli kalır.'); return; }
  if (target.dataset.action === 'remove-image') { appData.homeImage = ''; await persist(); render(); showToast('Ana ekran görseli kaldırıldı.'); return; }
  if (target.dataset.action === 'pin-menu') { const key = `menu:${currentMenuId}`; appData.pinned = appData.pinned.includes(key) ? appData.pinned.filter((item) => item !== key) : [...appData.pinned, key]; saveAndRender(); return; }
  if (target.dataset.action === 'delete-menu') { const menu = currentMenu(); if (menu && confirm(`“${menu.name}” menüsü ve içindeki kayıtlar silinsin mi?`)) { appData.menus = appData.menus.filter((item) => item.id !== menu.id); currentPage = 'menus'; saveAndRender(); } return; }
  if (target.dataset.pinItem) { const menu = currentMenu(); const item = menu?.items.find((record) => record.id === target.dataset.pinItem); if (item) item.pinned = !item.pinned; saveAndRender(); return; }
  if (target.dataset.toggleTask) { const menu = currentMenu(); const item = menu?.items.find((record) => record.id === target.dataset.toggleTask); if (item) item.done = !item.done; saveAndRender(); return; }
  if (target.dataset.itemMenu) { const menu = currentMenu(); const item = menu?.items.find((record) => record.id === target.dataset.itemMenu); if (!item) return; const action = prompt(`“${item.title}”\n\nDüzenlemek için yeni başlık yaz. Silmek için SİL yaz. İptal etmek için boş bırak.`); if (action === null || !action.trim()) return; if (action.trim().toLocaleLowerCase('tr') === 'sil') { if (confirm('Bu kayıt silinsin mi?')) menu.items = menu.items.filter((record) => record.id !== item.id); } else item.title = action.trim().slice(0,160); saveAndRender(); }
});
$('mainView').addEventListener('change', (event) => { if (event.target.id === 'homeImageInput') onImageSelected(event); if (event.target.id === 'importFile') onImportSelected(event); });
$('dialogBody').addEventListener('click', (event) => { if (event.target.closest('[data-close-dialog]')) closeDialog(); });
if (!window.crypto?.subtle || !window.isSecureContext) { $('lockedView').hidden = false; $('lockTitle').textContent = 'Güvenli bağlantı gerekli'; $('lockMessage').textContent = 'Şifreleme için uygulamayı HTTPS üzerinden açmalısın.'; $('unlockForm').hidden = true; } else setLocked();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
