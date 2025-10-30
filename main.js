// main.js - Cloudflare Pages + Telegram Bot (DNS Manager)
// نسخه بهینه شده با انتخاب رندوم DNS

const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;

const json = (obj, status = 200) => 
  new Response(JSON.stringify(obj, null, 2), { 
    status, 
    headers: { 'Content-Type': 'application/json; charset=utf-8' } 
  });

const html = (s) => 
  new Response(s, { 
    status: 200, 
    headers: { 'Content-Type': 'text/html; charset=utf-8' } 
  });

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

async function decrementStock(kv, code) {
  const entry = await getDnsEntry(kv, code);
  if (!entry) return false;
  
  if (entry.stock && entry.stock > 0) {
    entry.stock -= 1;
    await putDnsEntry(kv, entry);
    return true;
  }
  return false;
}

// === Web UI ===
function renderMainPage(entries) {
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
        <div class="form-group">
          <label>📦 موجودی</label>
          <input name="stock" type="number" placeholder="0" min="0" value="0" required>
        </div>
      </div>
      <div class="form-group full-width">
        <label>📡 آدرس‌های DNS (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;8.8.4.4" rows="5"></textarea>
        <small>هر آدرس DNS را در یک خط جداگانه وارد کنید</small>
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
  grid-template-columns: 2fr 1fr 1fr;
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
function buildMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🌐 DNS', callback_data: 'show_dns' }],
      [{ text: '🛰️ وایرگارد (غیرفعال)', callback_data: 'wireguard' }]
    ]
  };
}

// ساخت کیبورد لیست کشورها
function buildDnsKeyboard(entries) {
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    const stockEmoji = stock > 5 ? '🟢' : stock > 0 ? '🟡' : '🔴';
    return [{
      text: `${flag} ${e.country}`,
      callback_data: `dns:${e.code.toUpperCase()}`
    }, {
      text: `${stockEmoji} ${stock}`,
      callback_data: `stock:${e.code.toUpperCase()}`
    }];
  });
  
  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  
  return { inline_keyboard: rows };
}

// نمایش یک DNS رندوم از کشور انتخابی
async function handleDnsSelection(chat, messageId, code, env) {
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
      text: `${flag} *DNS کشور ${entry.country}*\n━━━━━━━━━━━━━━━━━━━━\n\n❌ *موجودی تمام شده است!*\n\nلطفاً کشور دیگری را انتخاب کنید.`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به لیست', callback_data: 'show_dns' }]] }
    });
  }
  
  // بررسی وجود آدرس
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} *DNS کشور ${entry.country}*\n━━━━━━━━━━━━━━━━━━━━\n\n⚠️ *هیچ آدرس DNSی موجود نیست!*`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به لیست', callback_data: 'show_dns' }]] }
    });
  }
  
  // انتخاب رندوم یک DNS
  const randomDns = getRandomItem(entry.addresses);
  const flag = countryCodeToFlag(entry.code);
  
  // کاهش موجودی
  await decrementStock(env.DB, code);
  
  // پیام با کپشن زیبا
  let msg = `╔═══════════════════════╗\n`;
  msg += `      ${flag} *DNS ${entry.country}*\n`;
  msg += `╚═══════════════════════╝\n\n`;
  msg += `🎯 *DNS اختصاصی شما:*\n`;
  msg += `\`${randomDns}\`\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💡 *نکته مهم:*\n`;
  msg += `این DNS را می‌توانید با *8.8.8.8* یا\n`;
  msg += `*DNS‌های گیمینگ ایرانی* تانل کنید\n`;
  msg += `تا بهترین سرعت و پایداری را داشته باشید.\n\n`;
  msg += `✅ *موفقیت همراه شما!*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📦 موجودی باقیمانده: *${entry.stock - 1}*`;
  
  return telegramApi(env, '/editMessageText', {
    chat_id: chat,
    message_id: messageId,
    text: msg,
    parse_mode: 'Markdown',
    reply_markup: { 
      inline_keyboard: [
        [{ text: '🔄 دریافت DNS جدید', callback_data: `dns:${code}` }],
        [{ text: '🔙 بازگشت به لیست', callback_data: 'show_dns' }]
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
      
      if (text.startsWith('/start')) {
        const kb = buildMainKeyboard();
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
      
      await telegramApi(env, '/answerCallbackQuery', { 
        callback_query_id: cb.id 
      });
      
      // نمایش منوی اصلی
      if (data === 'back_main') {
        const kb = buildMainKeyboard();
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '👋 *سلام! خوش آمدید*\n\n🌐 برای دریافت DNS، گزینه موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }
      
      // نمایش لیست DNS
      else if (data === 'show_dns') {
        const entries = await listDnsEntries(env.DB);
        const kb = buildDnsKeyboard(entries);
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '🌍 *لیست کشورها*\n\nکشور موردنظر را انتخاب کنید تا یک DNS رندوم دریافت کنید:\n\n🟢 موجودی زیاد\n🟡 موجودی کم\n🔴 ناموجود',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }
      
      // انتخاب یک کشور و دریافت DNS رندوم
      else if (data.startsWith('dns:')) {
        const code = data.split(':')[1];
        await handleDnsSelection(chat, messageId, code, env);
      }
      
      // کلیک روی موجودی (فقط نمایش)
      else if (data.startsWith('stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'این فقط نمایش موجودی است',
          show_alert: false
        });
      }
      
      // وایرگارد (غیرفعال)
      else if (data === 'wireguard') {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🛰️ بخش وایرگارد فعلاً غیرفعال است',
          show_alert: true
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
      return html(renderMainPage(entries));
    }
    
    // API: لیست DNS‌ها
    if (url.pathname === '/api/dns' && req.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      return json(entries);
    }
    
    // API: افزودن/ویرایش DNS
    if (url.pathname === '/api/admin/add-dns' && req.method === 'POST') {
      const form = await req.formData();
      const entry = {
        country: form.get('country').trim(),
        code: form.get('code').toUpperCase().trim(),
        stock: Number(form.get('stock')) || 0,
        addresses: (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean)
      };
      
      if (!entry.country || !entry.code || entry.code.length !== 2) {
        return html('<script>alert("اطلاعات نامعتبر است");history.back();</script>');
      }
      
      await putDnsEntry(env.DB, entry);
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
