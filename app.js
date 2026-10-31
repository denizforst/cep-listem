const STORAGE_KEY = 'cep-listem.encrypted.v1';
const BACKUP_FORMAT = 'cep-listem-backup';
const BACKUP_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (id) => document.getElementById(id);
let cryptoKey = null;
let appData = null;
let activeListId = null;
let toastTimer;

function bytesToBase64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function initialData() { const id = makeId(); return { schema: 1, activeListId: id, lists: [{ id, name: 'Günlük işler', tasks: [] }] }; }
function validateData(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.lists) || value.lists.length < 1 || value.lists.length > 100) throw new Error('Yedek dosyasının biçimi geçerli değil.');
  const lists = value.lists.map((list) => {
    if (!list || typeof list.id !== 'string' || typeof list.name !== 'string' || !Array.isArray(list.tasks) || list.tasks.length > 10000) throw new Error('Yedek dosyasındaki liste bilgileri geçersiz.');
    return { id: list.id.slice(0, 100), name: list.name.slice(0, 50), tasks: list.tasks.map((task) => {
      if (!task || typeof task.id !== 'string' || typeof task.text !== 'string' || typeof task.done !== 'boolean') throw new Error('Yedek dosyasındaki görev bilgileri geçersiz.');
      return { id: task.id.slice(0, 100), text: task.text.slice(0, 180), done: task.done, createdAt: Number(task.createdAt) || Date.now() };
    }) };
  });
  return { schema: 1, activeListId: lists.some((list) => list.id === value.activeListId) ? value.activeListId : lists[0].id, lists };
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
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return { data: validateData(JSON.parse(decoder.decode(plaintext))), key, salt };
}
async function persist() {
  const salt = appData.salt;
  const record = await encryptData(appData, cryptoKey, salt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}
function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800); }
function setLocked(message = 'Listelerin bu cihazda şifreli saklanır.') {
  appData = null; cryptoKey = null; $('mainView').hidden = true; $('lockedView').hidden = false; $('lockMessage').textContent = message;
  $('lockTitle').textContent = localStorage.getItem(STORAGE_KEY) ? 'Tekrar hoş geldin' : 'Kilit oluştur';
  $('unlockButton').textContent = localStorage.getItem(STORAGE_KEY) ? 'Kilidi Aç' : 'Parola Oluştur';
  $('passwordInput').autocomplete = localStorage.getItem(STORAGE_KEY) ? 'current-password' : 'new-password';
  $('passwordInput').value = ''; $('lockError').textContent = ''; $('passwordHint').hidden = !!localStorage.getItem(STORAGE_KEY);
  setTimeout(() => $('passwordInput').focus(), 50);
}
async function unlock(password) {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const salt = crypto.getRandomValues(new Uint8Array(16)); cryptoKey = await deriveKey(password, salt);
    appData = { ...initialData(), salt }; await persist();
  } else {
    const result = await decryptRecord(JSON.parse(saved), password); appData = { ...result.data, salt: result.salt }; cryptoKey = result.key;
  }
  activeListId = appData.activeListId; $('lockedView').hidden = true; $('mainView').hidden = false; render();
}
function render() {
  if (!appData) return;
  if (!appData.lists.some((list) => list.id === activeListId)) activeListId = appData.lists[0].id;
  appData.activeListId = activeListId;
  const active = appData.lists.find((list) => list.id === activeListId);
  $('listCount').textContent = String(appData.lists.length);
  $('listNav').replaceChildren(...appData.lists.map((list) => {
    const button = document.createElement('button'); button.className = `list-button${list.id === activeListId ? ' active' : ''}`; button.type = 'button';
    const dot = document.createElement('span'); dot.className = 'list-dot'; const name = document.createElement('span'); name.textContent = list.name;
    const number = document.createElement('span'); number.className = 'list-num'; number.textContent = String(list.tasks.filter((task) => !task.done).length);
    button.append(dot, name, number); button.addEventListener('click', () => { activeListId = list.id; appData.activeListId = list.id; persist(); render(); }); return button;
  }));
  $('activeListTitle').textContent = active.name;
  const done = active.tasks.filter((task) => task.done).length;
  $('taskSummary').textContent = active.tasks.length ? `${done} / ${active.tasks.length} tamamlandı` : 'Henüz görev yok';
  $('clearDoneButton').hidden = done === 0; $('deleteListButton').disabled = appData.lists.length === 1;
  $('emptyState').hidden = active.tasks.length > 0;
  $('taskList').replaceChildren(...active.tasks.map((task) => {
    const row = document.createElement('li'); row.className = `task-row${task.done ? ' done' : ''}`;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task.done; checkbox.setAttribute('aria-label', `${task.text} görevini tamamlandı olarak işaretle`);
    checkbox.addEventListener('change', () => { task.done = checkbox.checked; persist().then(render); });
    const text = document.createElement('span'); text.className = 'task-text'; text.textContent = task.text;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-task'; remove.textContent = '×'; remove.setAttribute('aria-label', `${task.text} görevini sil`);
    remove.addEventListener('click', () => { active.tasks = active.tasks.filter((item) => item.id !== task.id); persist().then(render); }); row.append(checkbox, text, remove); return row;
  }));
}
function saveAndRender() { return persist().then(render).catch(() => showToast('Kaydetme başarısız oldu. Cihazda boş alan olduğundan emin ol.')); }
function downloadBackup(record) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `cep-listem-yedek-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('unlockForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const password = $('passwordInput').value; $('lockError').textContent = '';
  if (password.length < 8) { $('lockError').textContent = 'Parola en az 8 karakter olmalı.'; return; }
  try { await unlock(password); } catch { cryptoKey = null; appData = null; $('lockError').textContent = 'Parola yanlış veya yedek verisi açılamadı.'; $('passwordInput').select(); }
});
$('lockNow').addEventListener('click', () => setLocked('Uygulama kilitlendi. Verilerin cihazında şifreli kalır.'));
$('newListForm').addEventListener('submit', (event) => {
  event.preventDefault(); const name = $('newListName').value.trim(); if (!name) return;
  if (appData.lists.some((list) => list.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { showToast('Bu isimde bir listen zaten var.'); return; }
  const list = { id: makeId(), name: name.slice(0, 50), tasks: [] }; appData.lists.push(list); activeListId = list.id; $('newListName').value = ''; saveAndRender();
});
$('newTaskForm').addEventListener('submit', (event) => {
  event.preventDefault(); const text = $('newTaskText').value.trim(); if (!text) return;
  const list = appData.lists.find((item) => item.id === activeListId); list.tasks.unshift({ id: makeId(), text: text.slice(0, 180), done: false, createdAt: Date.now() }); $('newTaskText').value = ''; saveAndRender();
});
$('deleteListButton').addEventListener('click', () => {
  if (appData.lists.length === 1) return;
  const list = appData.lists.find((item) => item.id === activeListId); if (!confirm(`“${list.name}” listesi ve içindeki görevler silinsin mi?`)) return;
  appData.lists = appData.lists.filter((item) => item.id !== list.id); activeListId = appData.lists[0].id; saveAndRender();
});
$('clearDoneButton').addEventListener('click', () => {
  const list = appData.lists.find((item) => item.id === activeListId); const done = list.tasks.filter((task) => task.done).length;
  if (!done || !confirm(`${done} tamamlanmış görev silinsin mi?`)) return; list.tasks = list.tasks.filter((task) => !task.done); saveAndRender();
});
$('exportButton').addEventListener('click', async () => {
  try { const backup = await encryptData(appData, cryptoKey, appData.salt); downloadBackup(backup); showToast('Şifreli yedek dosyası hazır.'); }
  catch { showToast('Yedek oluşturulamadı.'); }
});
$('importFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  if (file.size > 12_000_000) { showToast('Yedek dosyası çok büyük.'); return; }
  const backupPassword = prompt('Yedek dosyasının parolasını gir:'); if (backupPassword === null) return;
  try {
    const record = JSON.parse(await file.text()); const decrypted = await decryptRecord(record, backupPassword);
    if (!confirm(`Yedekte ${decrypted.data.lists.length} liste var. Mevcut cihaz verilerinin yerine yüklensin mi?`)) return;
    appData = { ...decrypted.data, salt: appData.salt }; activeListId = appData.activeListId; await persist(); render(); showToast('Yedek bu cihaza aktarıldı.');
  } catch { showToast('Yedek açılamadı. Parolayı ve dosyayı kontrol et.'); }
});
$('updateButton').addEventListener('click', async () => {
  if (!('serviceWorker' in navigator)) { showToast('Bu tarayıcı çevrim dışı kurulum desteği sunmuyor.'); return; }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) { showToast('Uygulamanın çevrim dışı dosyaları henüz hazır değil.'); return; }
    await registration.update(); showToast(registration.waiting || registration.installing ? 'Yeni sürüm bulundu; uygulamayı kapatıp açınca kullanılabilir.' : 'Uygulama güncel.');
  } catch { showToast('Güncelleme kontrol edilemedi. Uygulama kayıtlı sürümle çalışmaya devam eder.'); }
});

if (!window.crypto?.subtle || !window.isSecureContext) {
  $('lockedView').hidden = false; $('lockTitle').textContent = 'Güvenli bağlantı gerekli'; $('lockMessage').textContent = 'Şifreleme için uygulamayı HTTPS üzerinden açmalısın.'; $('unlockForm').hidden = true;
} else setLocked();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
