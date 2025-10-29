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

  async getDNSList() {
    const data = await this.kv.get('dns_list', 'json');
    return data || [];
  }

  async setDNSList(dnsList) {
    await this.kv.put('dns_list', JSON.stringify(dnsList));
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

  async getEndpointUsage(endpoint) {
    const key = `endpoint_usage_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const count = await this.kv.get(key);
    return parseInt(count || '0');
  }

  async incrementEndpointUsage(endpoint) {
    const key = `endpoint_usage_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const count = await this.getEndpointUsage(endpoint);
    await this.kv.put(key, (count + 1).toString());
    return count + 1;
  }

  async resetEndpointUsage(endpoint) {
    const key = `endpoint_usage_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await this.kv.put(key, '0');
  }
}

// Generate random cool config name
function generateCoolName() {
  const adjectives = [
    'Turbo', 'Mega', 'Ultra', 'Super', 'Hyper', 'Quantum', 'Cyber', 'Neon',
    'Atomic', 'Cosmic', 'Epic', 'Legendary', 'Phoenix', 'Dragon', 'Thunder',
    'Lightning', 'Storm', 'Blaze', 'Frost', 'Shadow', 'Ghost', 'Ninja',
    'Samurai', 'Warrior', 'Knight', 'Titan', 'Vortex', 'Matrix', 'Nexus',
    'Apex', 'Prime', 'Elite', 'Royal', 'Imperial', 'Supreme', 'Divine'
  ];
  
  const nouns = [
    'Wolf', 'Eagle', 'Falcon', 'Hawk', 'Lion', 'Tiger', 'Panther', 'Cheetah',
    'Bear', 'Shark', 'Viper', 'Cobra', 'Python', 'Raven', 'Phoenix', 'Dragon',
    'Demon', 'Angel', 'Wizard', 'Sorcerer', 'Mage', 'Hunter', 'Sniper',
    'Warrior', 'Fighter', 'Racer', 'Rider', 'Pilot', 'Captain', 'Commander',
    'Master', 'Legend', 'Hero', 'Champion', 'King', 'Emperor', 'Lord'
  ];
  
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
  
  return `${randomAdj}${randomNoun}${randomNum}`;
}

// Get country from IP
async function getCountryFromIP(ip) {
  try {
    const response = await fetch(`https://api.iplocation.net/?cmd=ip-country&ip=${ip}`);
    const data = await response.json();
    return {
      name: data.country_name || data.country_code2 || 'Unknown',
      code: data.country_code2 || 'XX'
    };
  } catch (error) {
    console.error('Error fetching country:', error);
    return { name: 'Unknown', code: 'XX' };
  }
}

// Get country flag emoji
function getCountryFlag(countryCode) {
  if (!countryCode || countryCode === 'XX') return '🏳️';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt());
  return String.fromCodePoint(...codePoints);
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
      } else if (data === 'get_dns') {
        await handleGetDNS(bot, db, chatId, messageId);
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
          const endpoints = await db.getEndpoints();
          
          let endpointStats = '';
          for (const endpoint of endpoints) {
            const usage = await db.getEndpointUsage(endpoint);
            endpointStats += `\n📡 ${endpoint}: ${usage}/5`;
          }
          
          await bot.sendMessage(chatId, 
            `📊 <b>آمار ربات</b>\n\n` +
            `👥 تعداد کاربران: ${allUsers.length}\n` +
            `📈 تعداد کانفیگ‌های تولید شده: ${userCount}\n\n` +
            `<b>وضعیت Endpoints:</b>${endpointStats}`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        if (text === '/reset') {
          const endpoints = await db.getEndpoints();
          for (const endpoint of endpoints) {
            await db.resetEndpointUsage(endpoint);
          }
          await bot.sendMessage(chatId, '✅ شمارنده تمام endpoint‌ها ریست شد.');
          return;
        }
      }

      // User commands
      if (text === '/start') {
        const keyboard = {
          inline_keyboard: [
            [{ text: '🔐 دریافت کانفیگ WireGuard', callback_data: 'get_config' }],
            [{ text: '🌐 دریافت DNS Server', callback_data: 'get_dns' }]
          ]
        };

        await bot.sendMessage(
          chatId,
          '👋 به ربات WireGuard خوش آمدید!\n\n' +
          '🔐 <b>کانفیگ WireGuard</b>: دریافت کانفیگ کامل VPN\n' +
          '🌐 <b>DNS Server</b>: دریافت آدرس DNS سرور\n\n' +
          '🔹 روی یکی از دکمه‌های زیر کلیک کنید:',
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

    // Find an endpoint with less than 5 users
    let selectedEndpoint = null;
    let availableEndpoints = [];
    
    for (const endpoint of endpoints) {
      const usage = await db.getEndpointUsage(endpoint);
      if (usage < 5) {
        availableEndpoints.push(endpoint);
      }
    }

    if (availableEndpoints.length === 0) {
      await bot.editMessageText(
        chatId,
        messageId,
        '❌ تمام endpoint‌ها پر هستند. لطفاً بعداً تلاش کنید یا با ادمین تماس بگیرید.'
      );
      return;
    }

    // Select random from available endpoints
    selectedEndpoint = availableEndpoints[Math.floor(Math.random() * availableEndpoints.length)];
    
    // Increment endpoint usage
    const currentUsage = await db.incrementEndpointUsage(selectedEndpoint);
    
    const endpointIP = extractIP(selectedEndpoint);

    // Get country
    let countryInfo = { name: 'Unknown', code: 'XX' };
    if (endpointIP) {
      countryInfo = await getCountryFromIP(endpointIP);
    }
    const countryFlag = getCountryFlag(countryInfo.code);
    const country = countryInfo.name;

    // Get DNS for country
    let dns = dnsServers[country] || dnsServers['default'] || '1.1.1.1, 1.0.0.1';

    // Generate config
    const config = await generateWireGuardConfig(selectedEndpoint, dns);

    // Increment user count
    await db.incrementUserCount();

    // Generate cool random name
    const coolName = generateCoolName();

    // Create config file with cool name
    const configBlob = new Blob([config.config], { type: 'text/plain' });
    const configFile = new File([configBlob], `${coolName}.conf`, { type: 'text/plain' });

    // Send config as file
    await bot.sendDocument(
      chatId,
      configFile,
      {
        caption: `🔐 <b>کانفیگ ${coolName}</b>\n\n` +
                 `${countryFlag} <b>کشور:</b> ${country}\n` +
                 `📡 <b>Endpoint:</b> <code>${selectedEndpoint}</code>\n` +
                 `👥 <b>ظرفیت:</b> ${currentUsage}/5\n` +
                 `🔑 <b>Public Key:</b> <code>${config.publicKey}</code>\n` +
                 `📍 <b>IP:</b> ${config.clientIP}\n` +
                 `🌐 <b>DNS:</b> ${dns}`,
        parse_mode: 'HTML'
      }
    );

    // Delete the "loading" message
    await bot.editMessageText(
      chatId,
      messageId,
      `✅ کانفیگ ${coolName} ارسال شد!`
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

// Handle DNS server request
async function handleGetDNS(bot, db, chatId, messageId) {
  try {
    // Get DNS list
    const dnsList = await db.getDNSList();

    if (dnsList.length === 0) {
      await bot.editMessageText(
        chatId,
        messageId,
        '❌ هیچ DNS سروری ثبت نشده است. لطفاً بعداً تلاش کنید.'
      );
      return;
    }

    // Select random DNS
    const randomDNS = dnsList[Math.floor(Math.random() * dnsList.length)];
    const dnsIP = randomDNS.ip;

    // Get country
    let countryInfo = { name: 'Unknown', code: 'XX' };
    if (dnsIP) {
      countryInfo = await getCountryFromIP(dnsIP);
    }
    const countryFlag = getCountryFlag(countryInfo.code);

    // Popular DNS servers for tunneling
    const tunnelDNS = [
      '8.8.8.8, 8.8.4.4 (Google)',
      '1.1.1.1, 1.0.0.1 (Cloudflare)',
      '9.9.9.9, 149.112.112.112 (Quad9)',
      '208.67.222.222, 208.67.220.220 (OpenDNS)',
      '10.202.10.202, 10.202.10.102 (Radar Game)',
      '185.55.226.26, 185.55.225.25 (bogzar)',
      '94.103.125.157, 94.103.125.158 (Shelter)',
      '178.22.122.101, 185.51.200.1 (Shecan)'
    ];

    const message = `🌐 <b>DNS Server شما</b>\n\n` +
                   `${countryFlag} <b>کشور:</b> ${countryInfo.name}\n` +
                   `📍 <b>آدرس:</b> <code>${dnsIP}</code>\n\n` +
                   `━━━━━━━━━━━━━━━━━━━\n\n` +
                   `💡 <b>برای تانل کردن می‌توانید از این DNS ها استفاده کنید:</b>\n\n` +
                   tunnelDNS.map(dns => `▫️ <code>${dns}</code>`).join('\n') + '\n\n' +
                   `━━━━━━━━━━━━━━━━━━━\n\n` +
                   `📝 <b>نحوه استفاده:</b>\n` +
                   `این آدرس را در تنظیمات DNS دستگاه خود قرار دهید.`;

    await bot.editMessageText(chatId, messageId, message);
  } catch (error) {
    console.error('Error getting DNS:', error);
    await bot.editMessageText(
      chatId,
      messageId,
      '❌ خطا در دریافت DNS. لطفاً دوباره تلاش کنید.'
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
    
    .input-group input, .input-group select, .input-group textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
      font-family: 'Courier New', monospace;
    }
    
    .input-group textarea {
      min-height: 120px;
      resize: vertical;
    }
    
    .input-group input:focus, .input-group select:focus, .input-group textarea:focus {
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
      <p>مدیریت Endpoints، DNS Servers و DNS List</p>
    </div>
    
    <div class="content">
      <div id="alert" class="alert"></div>
      
      <!-- Endpoints Section -->
      <div class="section">
        <h2>📡 مدیریت Endpoints</h2>
        <div class="input-group">
          <label>Endpoints (هر خط یک آدرس - مثال: 1.2.3.4:51820)</label>
          <textarea id="newEndpoints" placeholder="1.2.3.4:51820
5.6.7.8:51820
9.10.11.12:51820"></textarea>
        </div>
        <button class="btn" onclick="addEndpoints()">➕ افزودن Endpoints</button>
        
        <div class="list" id="endpointsList">
          <p style="text-align: center; color: #999;">در حال بارگذاری...</p>
        </div>
      </div>
      
      <!-- DNS Servers Section (for WireGuard configs) -->
      <div class="section">
        <h2>🌐 مدیریت DNS Servers (برای کانفیگ WireGuard)</h2>
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

      <!-- DNS List Section (for DNS Server distribution) -->
      <div class="section">
        <h2>🌍 مدیریت DNS List (برای توزیع DNS)</h2>
        <div class="input-group">
          <label>آدرس IP سرورهای DNS (هر خط یک IP)</label>
          <textarea id="dnsListIPs" placeholder="1.1.1.1
8.8.8.8
9.9.9.9"></textarea>
        </div>
        <button class="btn" onclick="addDNSToList()">➕ افزودن به لیست DNS</button>
        
        <div class="list" id="dnsListItems">
          <p style="text-align: center; color: #999;">در حال بارگذاری...</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    let endpoints = [];
    let dnsServers = {};
    let dnsList = [];

    // Load data on page load
    window.addEventListener('DOMContentLoaded', async () => {
      await loadEndpoints();
      await loadDNS();
      await loadDNSList();
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

    // Add endpoints (multiple)
    async function addEndpoints() {
      const textarea = document.getElementById('newEndpoints');
      const text = textarea.value.trim();
      
      if (!text) {
        showAlert('لطفاً حداقل یک endpoint وارد کنید', 'error');
        return;
      }
      
      // Split by newlines and filter empty lines
      const newEndpoints = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      if (newEndpoints.length === 0) {
        showAlert('لطفاً حداقل یک endpoint معتبر وارد کنید', 'error');
        return;
      }
      
      // Validate all endpoints
      const invalidEndpoints = newEndpoints.filter(ep => !/^[\d\.:]+$/.test(ep));
      if (invalidEndpoints.length > 0) {
        showAlert('فرمت نامعتبر: ' + invalidEndpoints.join(', '), 'error');
        return;
      }
      
      try {
        const response = await fetch('/api/endpoints/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoints: newEndpoints })
        });
        
        if (response.ok) {
          textarea.value = '';
          await loadEndpoints();
          showAlert(newEndpoints.length + ' endpoint با موفقیت اضافه شد');
        } else {
          showAlert('خطا در افزودن endpoints', 'error');
        }
      } catch (error) {
        console.error('Error adding endpoints:', error);
        showAlert('خطا در افزودن endpoints', 'error');
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

    // Load DNS List
    async function loadDNSList() {
      try {
        const response = await fetch('/api/dns-list');
        const data = await response.json();
        dnsList = data.dnsList || [];
        renderDNSList();
      } catch (error) {
        console.error('Error loading DNS list:', error);
        showAlert('خطا در بارگذاری DNS list', 'error');
      }
    }

    // Render DNS List
    function renderDNSList() {
      const list = document.getElementById('dnsListItems');
      
      if (dnsList.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999;">هیچ DNS در لیست ثبت نشده است</p>';
        return;
      }
      
      list.innerHTML = dnsList.map((item, index) => \`
        <div class="list-item">
          <span class="list-item-text">
            <strong>\${item.country || 'در حال بررسی...'}</strong> \${item.flag || '🏳️'} - <code>\${item.ip}</code>
          </span>
          <button class="list-item-btn" onclick="deleteDNSFromList(\${index})">🗑️ حذف</button>
        </div>
      \`).join('');
    }

    // Add DNS to List (multiple)
    async function addDNSToList() {
      const textarea = document.getElementById('dnsListIPs');
      const text = textarea.value.trim();
      
      if (!text) {
        showAlert('لطفاً حداقل یک IP وارد کنید', 'error');
        return;
      }
      
      // Split by newlines and filter empty lines
      const ips = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      if (ips.length === 0) {
        showAlert('لطفاً حداقل یک IP معتبر وارد کنید', 'error');
        return;
      }
      
      // Validate all IPs
      const invalidIPs = ips.filter(ip => !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
      if (invalidIPs.length > 0) {
        showAlert('فرمت IP نامعتبر: ' + invalidIPs.join(', '), 'error');
        return;
      }
      
      try {
        const response = await fetch('/api/dns-list/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ips })
        });
        
        if (response.ok) {
          textarea.value = '';
          await loadDNSList();
          showAlert(ips.length + ' DNS به لیست اضافه شد و کشورها در حال تشخیص هستند...');
        } else {
          showAlert('خطا در افزودن DNS', 'error');
        }
      } catch (error) {
        console.error('Error adding DNS to list:', error);
        showAlert('خطا در افزودن DNS', 'error');
      }
    }

    // Delete DNS from List
    async function deleteDNSFromList(index) {
      if (!confirm('آیا مطمئن هستید؟')) return;
      
      try {
        const response = await fetch('/api/dns-list', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index })
        });
        
        if (response.ok) {
          await loadDNSList();
          showAlert('DNS از لیست حذف شد');
        } else {
          showAlert('خطا در حذف DNS', 'error');
        }
      } catch (error) {
        console.error('Error deleting DNS from list:', error);
        showAlert('خطا در حذف DNS', 'error');
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

    // API: Add multiple endpoints
    if (url.pathname === '/api/endpoints/bulk' && request.method === 'POST') {
      const { endpoints: newEndpoints } = await request.json();
      const endpoints = await db.getEndpoints();
      endpoints.push(...newEndpoints);
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

    // API: Get DNS list
    if (url.pathname === '/api/dns-list' && request.method === 'GET') {
      const dnsList = await db.getDNSList();
      return new Response(JSON.stringify({ dnsList }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Add DNS to list
    if (url.pathname === '/api/dns-list' && request.method === 'POST') {
      const { ip } = await request.json();
      const dnsList = await db.getDNSList();
      
      // Get country info
      const countryInfo = await getCountryFromIP(ip);
      const flag = getCountryFlag(countryInfo.code);
      
      dnsList.push({
        ip: ip,
        country: countryInfo.name,
        countryCode: countryInfo.code,
        flag: flag
      });
      
      await db.setDNSList(dnsList);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Add multiple DNS to list
    if (url.pathname === '/api/dns-list/bulk' && request.method === 'POST') {
      const { ips } = await request.json();
      const dnsList = await db.getDNSList();
      
      // Get country info for all IPs
      for (const ip of ips) {
        const countryInfo = await getCountryFromIP(ip);
        const flag = getCountryFlag(countryInfo.code);
        
        dnsList.push({
          ip: ip,
          country: countryInfo.name,
          countryCode: countryInfo.code,
          flag: flag
        });
      }
      
      await db.setDNSList(dnsList);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Delete DNS from list
    if (url.pathname === '/api/dns-list' && request.method === 'DELETE') {
      const { index } = await request.json();
      const dnsList = await db.getDNSList();
      dnsList.splice(index, 1);
      await db.setDNSList(dnsList);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
