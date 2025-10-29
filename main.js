// Main bot logic and web panel
import { generateWireGuardConfig } from './wireguard.js';

// Telegram Bot API helper
class TelegramBot {
  constructor(token) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId, text, options = {}) {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: options.parse_mode || 'HTML',
      ...options
    };

    const response = await fetch(`${this.apiUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return response.json();
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: options.parse_mode || 'HTML',
      ...options
    };

    const response = await fetch(`${this.apiUrl}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return response.json();
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    const response = await fetch(`${this.apiUrl}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text
      })
    });

    return response.json();
  }

  async sendDocument(chatId, document, options = {}) {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', document);
    
    if (options.caption) formData.append('caption', options.caption);
    if (options.parse_mode) formData.append('parse_mode', options.parse_mode);

    const response = await fetch(`${this.apiUrl}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    return response.json();
  }
}

// Database helper
class Database {
  constructor(kv) {
    this.kv = kv;
  }

  async getEndpoints() {
    const data = await this.kv.get('endpoints', 'json');
    return data || [];
  }

  async setEndpoints(endpoints) {
    await this.kv.put('endpoints', JSON.stringify(endpoints));
  }

  async getDNSServers() {
    const data = await this.kv.get('dns_servers', 'json');
    return data || {};
  }

  async setDNSServers(dnsServers) {
    await this.kv.put('dns_servers', JSON.stringify(dnsServers));
  }

  async getUserCount() {
    const count = await this.kv.get('user_count');
    return parseInt(count || '0');
  }

  async incrementUserCount() {
    const count = await this.getUserCount();
    await this.kv.put('user_count', (count + 1).toString());
    return count + 1;
  }

  async getAllUserIds() {
    const data = await this.kv.get('all_users', 'json');
    return data || [];
  }

  async addUserId(userId) {
    const users = await this.getAllUserIds();
    if (!users.includes(userId)) {
      users.push(userId);
      await this.kv.put('all_users', JSON.stringify(users));
    }
  }
}

// Get country from IP
async function getCountryFromIP(ip) {
  try {
    const response = await fetch(`https://api.iplocation.net/?cmd=ip-country&ip=${ip}`);
    const data = await response.json();
    return data.country_name || data.country_code2 || 'Unknown';
  } catch (error) {
    console.error('Error fetching country:', error);
    return 'Unknown';
  }
}

// Extract IP from endpoint
function extractIP(endpoint) {
  const match = endpoint.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  return match ? match[1] : null;
}

// Handle Telegram updates
export async function handleUpdate(update, env, ctx) {
  const bot = new TelegramBot(env.BOT_TOKEN);
  const db = new Database(env.DB);
  const adminId = parseInt(env.ADMIN_ID);

  try {
    // Handle callback queries
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const data = callbackQuery.data;

      await bot.answerCallbackQuery(callbackQuery.id);

      if (data === 'get_config') {
        await handleGetConfig(bot, db, chatId, messageId);
      }

      return;
    }

    // Handle messages
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const text = message.text || '';
      const userId = message.from.id;

      // Track user
      await db.addUserId(userId);

      // Admin commands
      if (userId === adminId) {
        if (text === '/broadcast' && message.reply_to_message) {
          await handleBroadcast(bot, db, message.reply_to_message.text);
          await bot.sendMessage(chatId, '✅ پیام برای همه کاربران ارسال شد.');
          return;
        }

        if (text === '/stats') {
          const userCount = await db.getUserCount();
          const allUsers = await db.getAllUserIds();
          await bot.sendMessage(chatId, `📊 آمار ربات:\n\n👥 تعداد کاربران: ${allUsers.length}\n📈 تعداد کانفیگ‌های تولید شده: ${userCount}`);
          return;
        }
      }

      // User commands
      if (text === '/start') {
        const keyboard = {
          inline_keyboard: [
            [{ text: '🔐 دریافت کانفیگ WireGuard', callback_data: 'get_config' }]
          ]
        };

        await bot.sendMessage(
          chatId,
          '👋 به ربات WireGuard خوش آمدید!\n\n' +
          'با این ربات می‌توانید کانفیگ WireGuard دریافت کنید.\n\n' +
          '🔹 روی دکمه زیر کلیک کنید تا کانفیگ خود را دریافت کنید.',
          { reply_markup: keyboard }
        );
        return;
      }
    }
  } catch (error) {
    console.error('Error handling update:', error);
  }
}

// Handle config generation
async function handleGetConfig(bot, db, chatId, messageId) {
  try {
    // Get endpoints and DNS servers
    const endpoints = await db.getEndpoints();
    const dnsServers = await db.getDNSServers();

    if (endpoints.length === 0) {
      await bot.editMessageText(
        chatId,
        messageId,
        '❌ هیچ endpoint فعالی وجود ندارد. لطفاً بعداً تلاش کنید.'
      );
      return;
    }

    // Select random endpoint
    const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const endpointIP = extractIP(randomEndpoint);

    // Get country
    let country = 'Unknown';
    if (endpointIP) {
      country = await getCountryFromIP(endpointIP);
    }

    // Get DNS for country
    let dns = dnsServers[country] || dnsServers['default'] || '1.1.1.1, 1.0.0.1';

    // Generate config
    const config = await generateWireGuardConfig(randomEndpoint, dns);

    // Increment user count
    await db.incrementUserCount();

    // Create config file
    const configBlob = new Blob([config.config], { type: 'text/plain' });
    const configFile = new File([configBlob], 'wireguard.conf', { type: 'text/plain' });

    // Send config as file
    await bot.sendDocument(
      chatId,
      configFile,
      {
        caption: `🔐 <b>کانفیگ WireGuard شما</b>\n\n` +
                 `🌍 کشور: ${country}\n` +
                 `📡 Endpoint: ${randomEndpoint}\n` +
                 `🔑 Public Key: <code>${config.publicKey}</code>\n` +
                 `📍 IP: ${config.clientIP}\n` +
                 `🌐 DNS: ${dns}`,
        parse_mode: 'HTML'
      }
    );

    // Delete the "loading" message
    await bot.editMessageText(
      chatId,
      messageId,
      '✅ کانفیگ شما ارسال شد!'
    );
  } catch (error) {
    console.error('Error generating config:', error);
    await bot.editMessageText(
      chatId,
      messageId,
      '❌ خطا در تولید کانفیگ. لطفاً دوباره تلاش کنید.'
    );
  }
}

// Handle broadcast
async function handleBroadcast(bot, db, text) {
  const users = await db.getAllUserIds();
  
  for (const userId of users) {
    try {
      await bot.sendMessage(userId, text);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Error sending to user ${userId}:`, error);
    }
  }
}

// Web panel HTML
function getAdminPanelHTML() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>پنل مدیریت WireGuard Bot</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    
    .header h1 {
      font-size: 2em;
      margin-bottom: 10px;
    }
    
    .content {
      padding: 30px;
    }
    
    .section {
      margin-bottom: 40px;
    }
    
    .section h2 {
      color: #667eea;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
    }
    
    .input-group {
      margin-bottom: 15px;
    }
    
    .input-group label {
      display: block;
      margin-bottom: 5px;
      color: #333;
      font-weight: bold;
    }
    
    .input-group input, .input-group select {
      width: 100%;
      padding: 12px;
      border: 2px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
    }
    
    .input-group input:focus, .input-group select:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 30px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      transition: transform 0.2s;
    }
    
    .btn:hover {
      transform: translateY(-2px);
    }
    
    .btn:active {
      transform: translateY(0);
    }
    
    .btn-danger {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    
    .list {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 15px;
      margin-top: 15px;
    }
    
    .list-item {
      background: white;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    
    .list-item:last-child {
      margin-bottom: 0;
    }
    
    .list-item-text {
      flex: 1;
      font-family: monospace;
    }
    
    .list-item-btn {
      background: #f5576c;
      color: white;
      border: none;
      padding: 8px 15px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
    }
    
    .list-item-btn:hover {
      background: #d63447;
    }
    
    .alert {
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }
    
    .alert.success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    
    .alert.error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    
    .alert.show {
      display: block;
    }
    
    .country-dns-item {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }
    
    .country-dns-item input {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 پنل مدیریت WireGuard Bot</h1>
      <p>مدیریت Endpoints و DNS Servers</p>
    </div>
    
    <div class="content">
      <div id="alert" class="alert"></div>
      
      <!-- Endpoints Section -->
      <div class="section">
        <h2>📡 مدیریت Endpoints</h2>
        <div class="input-group">
          <label>Endpoint جدید (مثال: 1.2.3.4:51820)</label>
          <input type="text" id="newEndpoint" placeholder="IP:Port">
        </div>
        <button class="btn" onclick="addEndpoint()">➕ افزودن Endpoint</button>
        
        <div class="list" id="endpointsList">
          <p style="text-align: center; color: #999;">در حال بارگذاری...</p>
        </div>
      </div>
      
      <!-- DNS Servers Section -->
      <div class="section">
        <h2>🌐 مدیریت DNS Servers</h2>
        <div class="input-group">
          <label>کشور</label>
          <input type="text" id="dnsCountry" placeholder="مثال: Iran یا default">
        </div>
        <div class="input-group">
          <label>DNS Servers (با کاما جدا کنید)</label>
          <input type="text" id="dnsServers" placeholder="مثال: 1.1.1.1, 1.0.0.1">
        </div>
        <button class="btn" onclick="addDNS()">➕ افزودن DNS</button>
        
        <div class="list" id="dnsList">
          <p style="text-align: center; color: #999;">در حال بارگذاری...</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    let endpoints = [];
    let dnsServers = {};

    // Load data on page load
    window.addEventListener('DOMContentLoaded', async () => {
      await loadEndpoints();
      await loadDNS();
    });

    // Show alert
    function showAlert(message, type = 'success') {
      const alert = document.getElementById('alert');
      alert.textContent = message;
      alert.className = 'alert ' + type + ' show';
      setTimeout(() => {
        alert.classList.remove('show');
      }, 3000);
    }

    // Load endpoints
    async function loadEndpoints() {
      try {
        const response = await fetch('/api/endpoints');
        const data = await response.json();
        endpoints = data.endpoints || [];
        renderEndpoints();
      } catch (error) {
        console.error('Error loading endpoints:', error);
        showAlert('خطا در بارگذاری endpoints', 'error');
      }
    }

    // Render endpoints
    function renderEndpoints() {
      const list = document.getElementById('endpointsList');
      
      if (endpoints.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999;">هیچ endpoint ثبت نشده است</p>';
        return;
      }
      
      list.innerHTML = endpoints.map((endpoint, index) => \`
        <div class="list-item">
          <span class="list-item-text">\${endpoint}</span>
          <button class="list-item-btn" onclick="deleteEndpoint(\${index})">🗑️ حذف</button>
        </div>
      \`).join('');
    }

    // Add endpoint
    async function addEndpoint() {
      const input = document.getElementById('newEndpoint');
      const endpoint = input.value.trim();
      
      if (!endpoint) {
        showAlert('لطفاً endpoint را وارد کنید', 'error');
        return;
      }
      
      // Validate format
      if (!/^[\d\.:]+$/.test(endpoint)) {
        showAlert('فرمت endpoint نامعتبر است', 'error');
        return;
      }
      
      try {
        const response = await fetch('/api/endpoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint })
        });
        
        if (response.ok) {
          input.value = '';
          await loadEndpoints();
          showAlert('Endpoint با موفقیت اضافه شد');
        } else {
          showAlert('خطا در افزودن endpoint', 'error');
        }
      } catch (error) {
        console.error('Error adding endpoint:', error);
        showAlert('خطا در افزودن endpoint', 'error');
      }
    }

    // Delete endpoint
    async function deleteEndpoint(index) {
      if (!confirm('آیا مطمئن هستید؟')) return;
      
      try {
        const response = await fetch('/api/endpoints', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index })
        });
        
        if (response.ok) {
          await loadEndpoints();
          showAlert('Endpoint حذف شد');
        } else {
          showAlert('خطا در حذف endpoint', 'error');
        }
      } catch (error) {
        console.error('Error deleting endpoint:', error);
        showAlert('خطا در حذف endpoint', 'error');
      }
    }

    // Load DNS servers
    async function loadDNS() {
      try {
        const response = await fetch('/api/dns');
        const data = await response.json();
        dnsServers = data.dns || {};
        renderDNS();
      } catch (error) {
        console.error('Error loading DNS:', error);
        showAlert('خطا در بارگذاری DNS servers', 'error');
      }
    }

    // Render DNS servers
    function renderDNS() {
      const list = document.getElementById('dnsList');
      const entries = Object.entries(dnsServers);
      
      if (entries.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999;">هیچ DNS server ثبت نشده است</p>';
        return;
      }
      
      list.innerHTML = entries.map(([country, dns]) => \`
        <div class="list-item">
          <span class="list-item-text"><strong>\${country}:</strong> \${dns}</span>
          <button class="list-item-btn" onclick="deleteDNS('\${country}')">🗑️ حذف</button>
        </div>
      \`).join('');
    }

    // Add DNS
    async function addDNS() {
      const countryInput = document.getElementById('dnsCountry');
      const dnsInput = document.getElementById('dnsServers');
      
      const country = countryInput.value.trim();
      const dns = dnsInput.value.trim();
      
      if (!country || !dns) {
        showAlert('لطفاً تمام فیلدها را پر کنید', 'error');
        return;
      }
      
      try {
        const response = await fetch('/api/dns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, dns })
        });
        
        if (response.ok) {
          countryInput.value = '';
          dnsInput.value = '';
          await loadDNS();
          showAlert('DNS server با موفقیت اضافه شد');
        } else {
          showAlert('خطا در افزودن DNS server', 'error');
        }
      } catch (error) {
        console.error('Error adding DNS:', error);
        showAlert('خطا در افزودن DNS server', 'error');
      }
    }

    // Delete DNS
    async function deleteDNS(country) {
      if (!confirm('آیا مطمئن هستید؟')) return;
      
      try {
        const response = await fetch('/api/dns', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country })
        });
        
        if (response.ok) {
          await loadDNS();
          showAlert('DNS server حذف شد');
        } else {
          showAlert('خطا در حذف DNS server', 'error');
        }
      } catch (error) {
        console.error('Error deleting DNS:', error);
        showAlert('خطا در حذف DNS server', 'error');
      }
    }
  </script>
</body>
</html>`;
}

// Main worker export (for Cloudflare Pages Functions)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const db = new Database(env.DB);

    // Admin panel
    if (url.pathname === '/' || url.pathname === '/admin') {
      return new Response(getAdminPanelHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // API: Get endpoints
    if (url.pathname === '/api/endpoints' && request.method === 'GET') {
      const endpoints = await db.getEndpoints();
      return new Response(JSON.stringify({ endpoints }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Add endpoint
    if (url.pathname === '/api/endpoints' && request.method === 'POST') {
      const { endpoint } = await request.json();
      const endpoints = await db.getEndpoints();
      endpoints.push(endpoint);
      await db.setEndpoints(endpoints);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Delete endpoint
    if (url.pathname === '/api/endpoints' && request.method === 'DELETE') {
      const { index } = await request.json();
      const endpoints = await db.getEndpoints();
      endpoints.splice(index, 1);
      await db.setEndpoints(endpoints);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Get DNS servers
    if (url.pathname === '/api/dns' && request.method === 'GET') {
      const dns = await db.getDNSServers();
      return new Response(JSON.stringify({ dns }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Add DNS server
    if (url.pathname === '/api/dns' && request.method === 'POST') {
      const { country, dns } = await request.json();
      const dnsServers = await db.getDNSServers();
      dnsServers[country] = dns;
      await db.setDNSServers(dnsServers);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Delete DNS server
    if (url.pathname === '/api/dns' && request.method === 'DELETE') {
      const { country } = await request.json();
      const dnsServers = await db.getDNSServers();
      delete dnsServers[country];
      await db.setDNSServers(dnsServers);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
