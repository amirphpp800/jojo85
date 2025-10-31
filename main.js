const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;
const ADMIN_ID = 7240662021;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

// === Per-user Daily Quotas & History ===
function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function getUserQuota(kv, userId, type) {
  const key = `quota:${type}:${userId}:${todayKey()}`;
  const raw = await kv.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  return { count, limit: 3 };
}

async function incUserQuota(kv, userId, type) {
  const key = `quota:${type}:${userId}:${todayKey()}`;
  const raw = await kv.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  const next = count + 1;
  await kv.put(key, String(next), { expirationTtl: 86400 });
  return next;
}

async function addUserHistory(kv, userId, type, item) {
  const key = `history:${type}:${userId}`;
  const raw = await kv.get(key);
  const arr = raw ? JSON.parse(raw) : [];
  arr.unshift({ item, ts: Date.now() });
  while (arr.length > 10) arr.pop();
  await kv.put(key, JSON.stringify(arr));
}

async function getUserHistory(kv, userId, type) {
  const key = `history:${type}:${userId}`;
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : [];
}

const html = (s) =>
  new Response(s, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });

// ارسال فایل به تلگرام (sendDocument)
async function telegramUpload(env, method, formData) {
  try {
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/${method}`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (e) {
    console.error('خطا در Telegram Upload:', e);
    return {};
  }
}

// === WireGuard Helpers ===
const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];
const WG_FIXED_DNS = [
  '1.1.1.1','1.0.0.1','8.8.8.8','8.8.4.4','9.9.9.9','10.202.10.10','78.157.42.100','208.67.222.222','208.67.220.220','185.55.226.26','185.55.225.25','185.51.200.2'
];
const OPERATORS = {
  irancell: { title: 'ایرانسل', addresses: ['2.144.0.0/16'] },
  mci: { title: 'همراه اول', addresses: ['5.52.0.0/16'] },
  tci: { title: 'مخابرات', addresses: ['2.176.0.0/15','2.190.0.0/15'] },
  rightel: { title: 'رایتل', addresses: ['37.137.128.0/17','95.162.0.0/17'] },
  shatel: { title: 'شاتل موبایل', addresses: ['94.182.0.0/16','37.148.0.0/18'] }
};

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randName8() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function b64(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  const base = btoa(bin).replace(/=+$/,'');
  return base;
}

async function generateWireGuardKeys() {
  // X25519
  const keyPair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const rawPriv = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.privateKey));
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  return { privateKey: b64(rawPriv), publicKey: b64(rawPub) };
}

function buildWgConf({ privateKey, addresses, dns, mtu, listenPort }) {
  const addrLines = addresses.map(a => `Address = ${a}`).join('\n');
  return `[Interface]
PrivateKey = ${privateKey}
${addrLines}
DNS = ${dns}
MTU = ${mtu}
ListenPort = ${listenPort}
`;
}

function buildWireguardOperatorKb() {
  const rows = [];
  const ops = [
    ['irancell','mci'],
    ['tci','rightel'],
    ['shatel']
  ];
  ops.forEach(pair => {
    const row = pair.map(code => ({ text: OPERATORS[code].title, callback_data: `wg_op:${code}` }));
    rows.push(row);
  });
  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}

function buildWireguardDnsKb() {
  const rows = [];
  for (let i = 0; i < WG_FIXED_DNS.length; i += 2) {
    const a = WG_FIXED_DNS[i];
    const b = WG_FIXED_DNS[i+1];
    const row = [{ text: a, callback_data: `wg_dns_fixed:${a}` }];
    if (b) row.push({ text: b, callback_data: `wg_dns_fixed:${b}` });
    rows.push(row);
  }
  rows.push([{ text: '🔙 بازگشت', callback_data: 'wireguard' }]);
  return { inline_keyboard: rows };
}

async function setWgState(kv, userId, state) {
  await kv.put(`wg_state:${userId}`, JSON.stringify(state), { expirationTtl: 900 });
}
async function getWgState(kv, userId) {
  const raw = await kv.get(`wg_state:${userId}`);
  return raw ? JSON.parse(raw) : null;
}
async function clearWgState(kv, userId) { await kv.delete(`wg_state:${userId}`); }

function buildWireguardCountryKb(entries) {
  const rows = [];
  
  entries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;

    let stockEmoji = '🔴';
    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    // سه دکمه در یک ردیف - دایره رنگی سمت چپ، تعداد وسط، کشور سمت راست
    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `wg_stock:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `wg_stock:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${e.country}`,
        callback_data: `wg_dns_country_pick:${e.code.toUpperCase()}`
      }
    ]);
  });

  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}

// تبدیل کد کشور به پرچم
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const A = 0x1F1E6;
  return Array.from(code.toUpperCase())
    .map(c => String.fromCodePoint(A + c.charCodeAt(0) - 65))
    .join('');
}

// انتخاب رندوم از آرایه
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// === KV Helpers ===
async function listDnsEntries(kv) {
  const res = await kv.list({ prefix: 'dns:' });
  const entries = [];

  for (const k of res.keys) {
    const v = await kv.get(k.name);
    try {
      const parsed = JSON.parse(v);
      entries.push(parsed);
    } catch (e) {
      console.error(`خطا در پارس ${k.name}:`, e);
    }
  }

  entries.sort((a, b) => (a.country || '').localeCompare(b.country || ''));
  return entries;
}

async function getDnsEntry(kv, code) {
  const raw = await kv.get(`dns:${code.toUpperCase()}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putDnsEntry(kv, entry) {
  await kv.put(`dns:${entry.code.toUpperCase()}`, JSON.stringify(entry));
}

async function deleteDnsEntry(kv, code) {
  await kv.delete(`dns:${code.toUpperCase()}`);
}

// حذف یک آدرس از لیست آدرس‌های کشور و بروزرسانی موجودی
async function removeAddressFromEntry(kv, code, address) {
  const entry = await getDnsEntry(kv, code);
  if (!entry) return false;

  if (Array.isArray(entry.addresses)) {
    // حذف آدرس از لیست
    entry.addresses = entry.addresses.filter(addr => addr !== address);
    // بروزرسانی خودکار موجودی بر اساس تعداد آدرس‌های باقیمانده
    entry.stock = entry.addresses.length;
    await putDnsEntry(kv, entry);
    return true;
  }
  return false;
}

async function saveUser(kv, from) {
  if (!from || !from.id) return;
  const data = {
    id: from.id,
    first_name: from.first_name || '',
    last_name: from.last_name || '',
    username: from.username || ''
  };
  await kv.put(`users:${from.id}`, JSON.stringify(data));
}

// انتخاب یک DNS رندوم از لیست
function getRandomDns(entry) {
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    return null;
  }
  return entry.addresses[Math.floor(Math.random() * entry.addresses.length)];
}

// === Web UI ===
async function countUsers(kv) {
  try {
    const res = await kv.list({ prefix: 'users:' });
    return res.keys.length;
  } catch {
    return 0;
  }
}

function renderMainPage(entries, userCount) {
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code);
    const count = Array.isArray(e.addresses) ? e.addresses.length : 0;
    const stockColor = (e.stock || 0) > 5 ? '#10b981' : (e.stock || 0) > 0 ? '#f59e0b' : '#ef4444';

    return `
    <div class="dns-card">
      <div class="card-header">
        <div class="country-info">
          <span class="country-flag">${flag}</span>
          <div class="country-details">
            <h3>${escapeHtml(e.country)}</h3>
            <span class="country-code">${escapeHtml(e.code)}</span>
          </div>
        </div>
        <div class="card-actions">
          <form method="POST" action="/api/admin/delete-dns" style="display:inline;">
            <input type="hidden" name="code" value="${escapeHtml(e.code)}">
            <button type="submit" class="btn-delete" onclick="return confirm('آیا مطمئن هستید؟')">🗑️</button>
          </form>
        </div>
      </div>
      <div class="card-body">
        <div class="stat-item">
          <span class="stat-label">موجودی:</span>
          <span class="stat-value" style="color: ${stockColor};">${e.stock ?? 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">تعداد آدرس:</span>
          <span class="stat-value">${count}</span>
        </div>
      </div>
      <div class="card-footer">
        <details>
          <summary>مشاهده آدرس‌ها</summary>
          <div class="addresses-list">
            ${count > 0 ? e.addresses.map(addr => `<code>${escapeHtml(addr)}</code>`).join('') : '<span class="empty">هیچ آدرسی ثبت نشده</span>'}
          </div>
        </details>
      </div>
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌐 پنل مدیریت DNS</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${getWebCss()}</style>
</head>
<body>
<div class="container">
  <header class="main-header">
    <div class="header-content">
      <h1>🌐 پنل مدیریت DNS</h1>
      <p class="subtitle">مدیریت و پیکربندی سرورهای DNS در سراسر دنیا</p>
    </div>
    <div class="header-stats">
      <div class="stat-box">
        <span class="stat-number">${entries.length}</span>
        <span class="stat-text">کشور</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${entries.reduce((sum, e) => sum + (e.stock || 0), 0)}</span>
        <span class="stat-text">موجودی کل</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${userCount}</span>
        <span class="stat-text">کاربر ربات</span>
      </div>
    </div>
  </header>

  <section class="section">
    <div class="section-header">
      <h2>📋 لیست DNS‌های موجود</h2>
      <span class="badge">${entries.length} مورد</span>
    </div>
    <div class="dns-grid">
      ${rows || '<div class="empty-state">هنوز هیچ DNS ثبت نشده است</div>'}
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>➕ افزودن DNS جدید</h2>
    </div>
    <form method="POST" action="/api/admin/add-dns" class="dns-form">
      <div class="form-row">
        <div class="form-group">
          <label>🌍 نام کشور (فارسی)</label>
          <input name="country" placeholder="مثال: ایران" required autocomplete="off">
        </div>
        <div class="form-group">
          <label>🔤 کد کشور (2 حرفی)</label>
          <input name="code" placeholder="IR" maxlength="2" required autocomplete="off" style="text-transform:uppercase;">
        </div>
      </div>
      <div class="form-group full-width">
        <label>📡 آدرس‌های DNS (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;8.8.4.4" rows="5" required></textarea>
        <small>هر آدرس DNS را در یک خط جداگانه وارد کنید. موجودی به صورت خودکار بر اساس تعداد آدرس‌ها محاسبه می‌شود.</small>
      </div>
      <button type="submit" class="btn-submit">💾 ذخیره اطلاعات</button>
    </form>
  </section>
</div>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.dns-card');
  cards.forEach((card, i) => {
    card.style.animationDelay = (i * 0.05) + 's';
  });
});

// تابع تغییر تب
function showTab(tabName) {
  // حذف کلاس active از همه تب‌ها و محتویات
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // اضافه کردن کلاس active به تب و محتوای انتخابی
  document.querySelector(\`[onclick="showTab('\${tabName}')"]\`).classList.add('active');
  document.getElementById(\`\${tabName}-form\`).classList.add('active');
}

// بارگذاری اطلاعات کشور برای ویرایش
async function loadCountryData(code) {
  if (!code) {
    document.getElementById('current-addresses').innerHTML = 'انتخاب کشور را برای مشاهده آدرس‌های فعلی انجام دهید';
    document.getElementById('edit-stock').value = '0';
    return;
  }
  
  try {
    const response = await fetch('/api/dns');
    const entries = await response.json();
    const country = entries.find(e => e.code.toUpperCase() === code.toUpperCase());
    
    if (country) {
      document.getElementById('edit-stock').value = country.stock || 0;
      
      const addressesDiv = document.getElementById('current-addresses');
      if (country.addresses && country.addresses.length > 0) {
        addressesDiv.innerHTML = country.addresses.map(addr => 
          \`<code>\${addr}</code>\`
        ).join('');
      } else {
        addressesDiv.innerHTML = '<em style="color: #64748b;">هیچ آدرسی برای این کشور ثبت نشده</em>';
      }
    }
  } catch (error) {
    console.error('خطا در بارگذاری اطلاعات:', error);
  }
}
</script>
</body>
</html>`;
}

function getWebCss() {
  return `
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Vazirmatn', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  padding: 20px;
  line-height: 1.6;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
}

.main-header {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 20px;
  padding: 30px;
  margin-bottom: 30px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
}

.header-content h1 {
  font-size: 36px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 8px;
}

.subtitle {
  color: #64748b;
  font-size: 16px;
}

.header-stats {
  display: flex;
  gap: 20px;
  margin-top: 20px;
}

.stat-box {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  padding: 15px 25px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 120px;
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
}

.stat-text {
  font-size: 14px;
  opacity: 0.9;
}

.section {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 20px;
  padding: 30px;
  margin-bottom: 30px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  padding-bottom: 15px;
  border-bottom: 2px solid #e2e8f0;
}

.section-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
}

.badge {
  background: #e0e7ff;
  color: #4f46e5;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
}

.dns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.dns-card {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  animation: slideIn 0.4s ease forwards;
  opacity: 0;
}

@keyframes slideIn {
  to { opacity: 1; transform: translateY(0); }
  from { opacity: 0; transform: translateY(20px); }
}

.dns-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.card-header {
  background: linear-gradient(135deg, #f8fafc, #e2e8f0);
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.country-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.country-flag {
  font-size: 36px;
}

.country-details h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
}

.country-code {
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
  background: white;
  padding: 2px 8px;
  border-radius: 6px;
}

.btn-delete {
  background: #fee2e2;
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s;
}

.btn-delete:hover {
  background: #fecaca;
  transform: scale(1.1);
}

.card-body {
  padding: 20px;
  display: flex;
  gap: 20px;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 13px;
  color: #64748b;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
}

.card-footer {
  border-top: 1px solid #e2e8f0;
  padding: 15px 20px;
}

details summary {
  cursor: pointer;
  font-weight: 500;
  color: #667eea;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

details summary::-webkit-details-marker {
  display: none;
}

details summary::before {
  content: '◀';
  transition: transform 0.2s;
}

details[open] summary::before {
  transform: rotate(-90deg);
}

.addresses-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.addresses-list code {
  background: #f1f5f9;
  padding: 8px 12px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  color: #1e293b;
  border-left: 3px solid #667eea;
}

.empty {
  color: #94a3b8;
  font-size: 14px;
  font-style: italic;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
  font-size: 16px;
}

.dns-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 15px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group.full-width {
  grid-column: 1 / -1;
}

label {
  font-weight: 500;
  color: #334155;
  font-size: 14px;
}

input, textarea {
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  font-family: 'Vazirmatn', sans-serif;
  font-size: 15px;
  transition: all 0.2s;
  background: white;
}

input:focus, textarea:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

textarea {
  resize: vertical;
  min-height: 100px;
  font-family: 'Courier New', monospace;
}

small {
  color: #64748b;
  font-size: 13px;
}

.btn-submit {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  padding: 14px 28px;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-submit:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}

.btn-submit:active {
  transform: translateY(0);
}

.form-tabs {
  display: flex;
  margin-bottom: 20px;
  border-bottom: 2px solid #e2e8f0;
}

.tab-btn {
  background: none;
  border: none;
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
  font-family: 'Vazirmatn', sans-serif;
}

.tab-btn.active {
  color: #667eea;
  border-bottom-color: #667eea;
}

.tab-btn:hover:not(.active) {
  color: #475569;
  background: #f8fafc;
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

select {
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  font-family: 'Vazirmatn', sans-serif;
  font-size: 15px;
  transition: all 0.2s;
  background: white;
  cursor: pointer;
}

select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.current-addresses {
  background: #f8fafc;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  padding: 15px;
  min-height: 60px;
  color: #64748b;
  font-size: 14px;
}

.current-addresses code {
  display: block;
  background: white;
  padding: 8px 12px;
  border-radius: 6px;
  margin: 4px 0;
  font-family: 'Courier New', monospace;
  color: #1e293b;
  border-left: 3px solid #667eea;
}

@media (max-width: 768px) {
  .dns-grid {
    grid-template-columns: 1fr;
  }
  
  .form-row {
    grid-template-columns: 1fr;
  }
  
  .header-stats {
    flex-direction: column;
  }
  
  .stat-box {
    width: 100%;
  }

  .form-tabs {
    flex-direction: column;
  }
  
  .tab-btn {
    text-align: center;
    border-bottom: none;
    border-right: 3px solid transparent;
  }
  
  .tab-btn.active {
    border-right-color: #667eea;
    border-bottom-color: transparent;
  }
}
`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// === Telegram Bot ===
async function telegramApi(env, path, body) {
  try {
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error('خطا در Telegram API:', e);
    return {};
  }
}

// ساخت کیبورد اصلی
function buildMainKeyboard(userId) {
  const rows = [];
  // سطر اول: وایرگارد و دی ان اس کنار هم
  rows.push([
    { text: '🛰️ وایرگارد', callback_data: 'wireguard' },
    { text: '🧭 دی ان اس', callback_data: 'show_dns' }
  ]);
  // سطر دوم: حساب کاربری
  rows.push([{ text: '👤 حساب کاربری', callback_data: 'account' }]);
  // سطر سوم: ادمین (در صورت نیاز)
  if (Number(userId) === Number(ADMIN_ID)) {
    rows.push([{ text: '📢 پیام همگانی', callback_data: 'broadcast' }]);
  }
  return { inline_keyboard: rows };
}

// ساخت کیبورد لیست کشورها با صفحه‌بندی
function buildDnsKeyboard(entries, page = 0) {
  const ITEMS_PER_PAGE = 12;
  const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEntries = entries.slice(startIndex, endIndex);

  const rows = [];

  currentEntries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    const totalAddresses = Array.isArray(e.addresses) ? e.addresses.length : 0;

    let stockEmoji = '🔴';

    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    // سه دکمه در یک ردیف - دایره رنگی سمت چپ، تعداد وسط، کشور سمت راست
    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `stock:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `stock:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${e.country}`,
        callback_data: `dns:${e.code.toUpperCase()}`
      }
    ]);
  });

  // اضافه کردن دکمه‌های صفحه‌بندی
  if (totalPages > 1) {
    const paginationRow = [];

    // دکمه صفحه قبل
    if (page > 0) {
      paginationRow.push({
        text: '⬅️ قبلی',
        callback_data: `page:${page - 1}`
      });
    }

    // نمایش شماره صفحه فعلی
    paginationRow.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `current_page`
    });

    // دکمه صفحه بعد
    if (page < totalPages - 1) {
      paginationRow.push({
        text: 'بعدی ➡️',
        callback_data: `page:${page + 1}`
      });
    }

    rows.push(paginationRow);
  }

  rows.push([{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]);

  return { inline_keyboard: rows };
}

// نمایش یک DNS رندوم از کشور انتخابی
async function handleDnsSelection(chat, messageId, code, env, userId) {
  const entry = await getDnsEntry(env.DB, code);

  if (!entry) {
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: '❌ هیچ DNSی برای این کشور یافت نشد.',
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // بررسی موجودی
  if (!entry.stock || entry.stock <= 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${entry.country}\n\nناموجود. کشور دیگری را انتخاب کنید.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // بررسی وجود آدرس
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${entry.country}\n\nهیچ آدرسی ثبت نشده است.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // محدودیت روزانه کاربر برای دریافت DNS
  const quota = await getUserQuota(env.DB, userId, 'dns');
  if (quota.count >= quota.limit) {
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `⏳ محدودیت روزانه دریافت DNS شما به پایان رسیده است.\nامروز مجاز: ${quota.limit} مورد`,
      reply_markup: { inline_keyboard: [[{ text: '👤 حساب کاربری', callback_data: 'account' }],[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // انتخاب یک DNS رندوم
  const selectedDns = getRandomDns(entry);

  if (!selectedDns) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${entry.country}\n\nهیچ آدرسی موجود نیست.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  const flag = countryCodeToFlag(entry.code);

  // افزایش مصرف کاربر و حذف آدرس از لیست
  await incUserQuota(env.DB, userId, 'dns');
  const newQuota = await getUserQuota(env.DB, userId, 'dns');
  await addUserHistory(env.DB, userId, 'dns', `${entry.code}:${selectedDns}`);
  // حذف آدرس استفاده شده از لیست و بروزرسانی خودکار موجودی
  await removeAddressFromEntry(env.DB, code, selectedDns);
  
  // دریافت موجودی جدید
  const updatedEntry = await getDnsEntry(env.DB, code);
  const remainingStock = updatedEntry ? updatedEntry.stock : 0;

  // پیام مینیمال
  let msg = `${flag} دی ان اس ${entry.country}\n\n`;
  msg += `آدرس اختصاصی شما:\n\`${selectedDns}\`\n\n`;
  msg += `📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}\n`;
  msg += `📦 موجودی باقی‌مانده ${entry.country}: ${remainingStock}\n\n`;
  msg += `🎮 DNS‌های پیشنهادی برای تانل:\n`;
  msg += `• \`178.22.122.100\` - شاتل\n`;
  msg += `• \`185.51.200.2\` - ایرانسل\n`;
  msg += `• \`10.202.10.10\` - رادار\n`;
  msg += `• \`8.8.8.8\` - گوگل\n`;
  msg += `• \`1.1.1.1\` - کلودفلر\n`;
  msg += `• \`4.2.2.4\` - لول 3\n`;
  msg += `• \`78.157.42.100\` - الکترو`;

  return telegramApi(env, '/editMessageText', {
    chat_id: chat,
    message_id: messageId,
    text: msg,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 دریافت DNS جدید', callback_data: `dns:${code}` }],
        [{ text: '🔙 بازگشت', callback_data: 'show_dns' }]
      ]
    }
  });
}

// مدیریت آپدیت‌های تلگرام
export async function handleUpdate(update, env) {
  try {
    // پیام‌های عادی
    if (update.message) {
      const msg = update.message;
      const chat = msg.chat.id;
      const text = msg.text || '';
      const from = msg.from || {};

      await saveUser(env.DB, from);

      if (Number(from.id) === Number(ADMIN_ID)) {
        const state = await env.DB.get(`admin_state:${ADMIN_ID}`);
        if (state === 'broadcast_waiting' && text && !text.startsWith('/start')) {
          const res = await env.DB.list({ prefix: 'users:' });
          let sent = 0;
          for (const k of res.keys) {
            const userId = Number(k.name.split(':')[1]);
            if (!userId) continue;
            await telegramApi(env, '/sendMessage', { chat_id: userId, text });
            sent++;
          }
          await env.DB.delete(`admin_state:${ADMIN_ID}`);
          await telegramApi(env, '/sendMessage', { chat_id: chat, text: `✅ پیام برای ${sent} کاربر ارسال شد.` });
          return;
        }
      }

      if (text.startsWith('/start')) {
        const kb = buildMainKeyboard(from.id);
        await telegramApi(env, '/sendMessage', {
          chat_id: chat,
          text: '👋 *سلام! خوش آمدید*\n\n🌐 برای دریافت DNS، گزینه موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      } else {
        await telegramApi(env, '/sendMessage', {
          chat_id: chat,
          text: '❌ دستور نامعتبر است.\n\nلطفاً /start را ارسال کنید.'
        });
      }
    }

    // Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const chat = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const from = cb.from || {};

      await saveUser(env.DB, from);

      await telegramApi(env, '/answerCallbackQuery', {
        callback_query_id: cb.id
      });

      // نمایش منوی اصلی
      if (data === 'back_main') {
        const kb = buildMainKeyboard(from.id);
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '👋 *سلام! خوش آمدید*\n\n🌐 برای دریافت DNS، گزینه موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // نمایش لیست DNS
      else if (data === 'show_dns' || data.startsWith('page:')) {
        const entries = await listDnsEntries(env.DB);
        if (entries.length === 0) {
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '❌ *هیچ DNSی موجود نیست*\n\nلطفاً ابتدا از پنل مدیریت، DNS‌های موردنظر را اضافه کنید.',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
          });
        } else {
          // تعیین شماره صفحه
          const page = data.startsWith('page:') ? parseInt(data.split(':')[1]) || 0 : 0;
          const kb = buildDnsKeyboard(entries, page);
          const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
          const totalPages = Math.ceil(entries.length / 12);
          const currentPage = page + 1;

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `🌍 *لیست کشورهای موجود*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *${currentPage}/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
            parse_mode: 'Markdown',
            reply_markup: kb
          });
        }
      }

      // انتخاب یک کشور و دریافت DNS رندوم
      else if (data.startsWith('dns:')) {
        const code = data.split(':')[1];
        await handleDnsSelection(chat, messageId, code, env, from.id);
      }

      // کلیک روی موجودی DNS (راهنمایی کاربر)
      else if (data.startsWith('stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای دریافت آدرس، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی موجودی WireGuard (راهنمایی کاربر)
      else if (data.startsWith('wg_stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای انتخاب کشور، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی شماره صفحه فعلی
      else if (data === 'current_page') {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'این صفحه فعلی است',
          show_alert: false
        });
      }

      // وایرگارد: شروع => انتخاب کشور
      else if (data === 'wireguard') {
        await clearWgState(env.DB, from.id);
        const entries = await listDnsEntries(env.DB);
        const kb = buildWireguardCountryKb(entries);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب اپراتور => ساخت فایل (باید DNS و کشور از قبل انتخاب شده باشد)
      else if (data.startsWith('wg_op:')) {
        const opCode = data.split(':')[1];
        if (!OPERATORS[opCode]) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اپراتور نامعتبر', show_alert: true });
        } else {
          const state = await getWgState(env.DB, from.id);
          if (!state || !state.dns || !state.country) {
            await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'ابتدا کشور و دی ان اس را انتخاب کنید', show_alert: true });
          } else {
            // کوئوتا وایرگارد
            const quota = await getUserQuota(env.DB, from.id, 'wg');
            if (quota.count >= quota.limit) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: messageId,
                text: '⏳ سهمیه امروز وایرگارد شما تمام شد (3/3)',
                reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
              });
            } else {
              // ساخت و ارسال فایل
              const keys = await generateWireGuardKeys();
              const addresses = OPERATORS[opCode].addresses;
              const mtu = randItem(WG_MTUS);
              const listenPort = randInt(40000, 60000);
              const dnsList = Array.isArray(state.dns) ? state.dns : [state.dns];
              const conf = buildWgConf({ privateKey: keys.privateKey, addresses, dns: dnsList.join(', '), mtu, listenPort });
              const filename = `${randName8()}.conf`;
              const fd = new FormData();
              fd.append('chat_id', String(chat));
              fd.append('caption', `نام: ${filename}\n• اپراتور: ${OPERATORS[opCode].title}\n• دی ان اس: ${dnsList.join(' , ')}\n• MTU: ${mtu}\n• پورت: ${listenPort}\n\nنکته: ListenPort بین 40000 تا 60000 باشد.`);
              fd.append('document', new File([conf], filename, { type: 'text/plain' }));
              await telegramUpload(env, 'sendDocument', fd);
              await incUserQuota(env.DB, from.id, 'wg');
              const newQuota = await getUserQuota(env.DB, from.id, 'wg');
              await addUserHistory(env.DB, from.id, 'wg', `${state.country}|${dnsList.join('+')}|${mtu}|${listenPort}`);
              await clearWgState(env.DB, from.id);
              
              // پیام موفقیت
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: messageId,
                text: `✅ فایل وایرگارد با موفقیت ارسال شد!\n\n📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}`,
                reply_markup: { inline_keyboard: [[{ text: '🔄 دریافت فایل جدید', callback_data: 'wireguard' }],[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
              });
            }
          }
        }
      }

      // وایرگارد: بازگشت از انتخاب DNS به لیست کشورها
      else if (data === 'wireguard_dns_back') {
        const entries = await listDnsEntries(env.DB);
        const kb = buildWireguardCountryKb(entries);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: نمایش کشورها (میانبر)
      else if (data === 'wg_dns_country') {
        const entries = await listDnsEntries(env.DB);
        const kb = buildWireguardCountryKb(entries);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب کشور => ذخیره و نمایش دی ان اس‌های ثابت برای انتخاب
      else if (data.startsWith('wg_dns_country_pick:')) {
        const code = data.split(':')[1];
        const entry = await getDnsEntry(env.DB, code);
        const flag = countryCodeToFlag(code);
        const countryName = entry ? entry.country : code;
        
        await setWgState(env.DB, from.id, { country: code, step: 'dns' });
        const kb = buildWireguardDnsKb();
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `کشور انتخابی: ${flag} ${countryName} (${code})\n\nیکی از دی ان اس‌های زیر را انتخاب کنید:`,
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب DNS ثابت => اضافه‌کردن یک DNS رندوم از کشور (در صورت وجود) و سپس انتخاب اپراتور
      else if (data.startsWith('wg_dns_fixed:')) {
        const fixedDns = data.split(':')[1];
        const state = await getWgState(env.DB, from.id);
        if (!state || !state.country) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'ابتدا کشور را انتخاب کنید', show_alert: true });
        } else {
          const entry = await getDnsEntry(env.DB, state.country);
          let randomDns = null;
          if (entry) {
            randomDns = getRandomDns(entry);
          }
          const dnsList = randomDns && randomDns !== fixedDns ? [fixedDns, randomDns] : [fixedDns];
          await setWgState(env.DB, from.id, { country: state.country, dns: dnsList, step: 'op' });
          const kb = buildWireguardOperatorKb();
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `اپراتور خود را انتخاب کنید:`,
            reply_markup: kb
          });
        }
      }

      // حساب کاربری
      else if (data === 'account') {
        const dnsQuota = await getUserQuota(env.DB, from.id, 'dns');
        const wgQuota = await getUserQuota(env.DB, from.id, 'wg');
        const dnsHistory = await getUserHistory(env.DB, from.id, 'dns');
        const wgHistory = await getUserHistory(env.DB, from.id, 'wg');

        let msg = '👤 *حساب کاربری*\n';
        msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
        msg += `👋 نام: ${from.first_name || 'کاربر'}\n`;
        if (from.username) msg += `🆔 یوزرنیم: @${from.username}\n`;
        msg += `🔢 شناسه: \`${from.id}\`\n\n`;
        
        msg += '📊 *سهمیه روزانه:*\n';
        msg += `🧭 DNS: ${dnsQuota.count}/${dnsQuota.limit}\n`;
        msg += `🛰️ WireGuard: ${wgQuota.count}/${wgQuota.limit}\n\n`;

        if (dnsHistory.length > 0) {
          msg += '📜 *آخرین دریافت‌های DNS:*\n';
          dnsHistory.slice(0, 5).forEach((h, i) => {
            const parts = h.item.split(':');
            msg += `${i + 1}. ${parts[0]} - \`${parts[1]}\`\n`;
          });
          msg += '\n';
        }

        if (wgHistory.length > 0) {
          msg += '📜 *آخرین فایل‌های WireGuard:*\n';
          wgHistory.slice(0, 3).forEach((h, i) => {
            const parts = h.item.split('|');
            msg += `${i + 1}. ${parts[0]} - MTU: ${parts[2]}\n`;
          });
        }

        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: msg,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
        });
      }

      // پیام همگانی (فقط ادمین)
      else if (data === 'broadcast') {
        if (Number(from.id) !== Number(ADMIN_ID)) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          await env.DB.put(`admin_state:${ADMIN_ID}`, 'broadcast_waiting');
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '✍️ متن پیام همگانی را ارسال کنید.',
            reply_markup: { inline_keyboard: [[{ text: 'لغو', callback_data: 'cancel_broadcast' }]] }
          });
        }
      }

      else if (data === 'cancel_broadcast') {
        if (Number(from.id) === Number(ADMIN_ID)) {
          await env.DB.delete(`admin_state:${ADMIN_ID}`);
        }
        const kb = buildMainKeyboard(from.id);
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: 'بازگشت به منوی اصلی.',
          reply_markup: kb
        });
      }
    }
  } catch (e) {
    console.error('خطا در handleUpdate:', e);
  }
}

// === Fetch Handler ===
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // صفحه اصلی
    if (url.pathname === '/' && req.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      const userCount = await countUsers(env.DB);
      return html(renderMainPage(entries, userCount));
    }

    // API: لیست DNS‌ها
    if (url.pathname === '/api/dns' && req.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      return json(entries);
    }

    // API: افزودن/ویرایش DNS
    if (url.pathname === '/api/admin/add-dns' && req.method === 'POST') {
      const form = await req.formData();
      const action = form.get('action') || 'new';

      if (action === 'new') {
        // ایجاد کشور جدید
        const addresses = (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);

        const entry = {
          country: form.get('country').trim(),
          code: form.get('code').toUpperCase().trim(),
          addresses: addresses,
          stock: addresses.length  // موجودی خودکار بر اساس تعداد آدرس‌ها
        };

        if (!entry.country || !entry.code || entry.code.length !== 2) {
          return html('<script>alert("اطلاعات نامعتبر است");history.back();</script>');
        }

        // بررسی عدم تکرار کد کشور
        const existing = await getDnsEntry(env.DB, entry.code);
        if (existing) {
          return html('<script>alert("این کد کشور قبلاً ثبت شده است");history.back();</script>');
        }

        await putDnsEntry(env.DB, entry);
      }
      else if (action === 'edit') {
        // ویرایش کشور موجود - اضافه کردن آدرس‌های جدید
        const code = form.get('existing_code').toUpperCase().trim();
        const newAddresses = (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);

        if (!code || code.length !== 2) {
          return html('<script>alert("کد کشور نامعتبر است");history.back();</script>');
        }

        // دریافت اطلاعات فعلی
        const existing = await getDnsEntry(env.DB, code);
        if (!existing) {
          return html('<script>alert("کشور انتخابی یافت نشد");history.back();</script>');
        }

        // اضافه کردن آدرس‌های جدید به آدرس‌های موجود
        if (newAddresses.length > 0) {
          const currentAddresses = Array.isArray(existing.addresses) ? existing.addresses : [];
          const combinedAddresses = [...currentAddresses, ...newAddresses];
          // حذف آدرس‌های تکراری
          existing.addresses = [...new Set(combinedAddresses)];
          // بروزرسانی خودکار موجودی بر اساس تعداد کل آدرس‌ها
          existing.stock = existing.addresses.length;
        }

        await putDnsEntry(env.DB, existing);
      }

      return html('<script>window.location.href="/";</script>');
    }

    // API: حذف DNS
    if (url.pathname === '/api/admin/delete-dns' && req.method === 'POST') {
      const form = await req.formData();
      const code = form.get('code');

      if (code) {
        await deleteDnsEntry(env.DB, code);
      }

      return html('<script>window.location.href="/";</script>');
    }

    // Webhook تلگرام
    if (url.pathname === '/webhook' && req.method === 'POST') {
      try {
        const update = await req.json();
        await handleUpdate(update, env);
        return json({ ok: true });
      } catch (e) {
        console.error('خطا در webhook:', e);
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // تنظیم webhook
    if (url.pathname === '/api/set-webhook' && req.method === 'GET') {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const result = await res.json();
      return json(result);
    }

    // حذف webhook
    if (url.pathname === '/api/delete-webhook' && req.method === 'GET') {
      const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/deleteWebhook`, {
        method: 'POST'
      });
      const result = await res.json();
      return json(result);
    }

    // وضعیت webhook
    if (url.pathname === '/api/webhook-info' && req.method === 'GET') {
      const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/getWebhookInfo`);
      const result = await res.json();
      return json(result);
    }

    // 404
    return html('<h1>404 - صفحه یافت نشد</h1>');
  }
};
