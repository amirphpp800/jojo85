// ═════════════════════════════════════════════════════════════════════════════
// 👥 GROUP COMMANDS MODULE
// ═════════════════════════════════════════════════════════════════════════════
// این ماژول شامل تمام توابع و دستورات مربوط به گروه‌های تلگرام است

// ─────────────────────────────────────────────────────────────────────────────
// 🎲 Random Country Selection for Groups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * انتخاب رندوم کشور با DNS موجود
 * @param {Object} kv - Cloudflare KV instance
 * @param {Function} listDnsEntries - تابع لیست DNS
 * @returns {Object|null} - کشور انتخاب شده یا null
 */
export async function getRandomCountryWithDns(kv, listDnsEntries) {
  const entries = await listDnsEntries(kv);
  if (entries.length === 0) return null;
  
  // فقط کشورهایی که موجودی دارند
  const available = entries.filter(e => e.addresses && e.addresses.length > 0);
  if (available.length === 0) return null;
  
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * انتخاب رندوم کشور با IPv6 موجود
 * @param {Object} kv - Cloudflare KV instance
 * @param {Function} listIpv6Entries - تابع لیست IPv6
 * @returns {Object|null} - کشور انتخاب شده یا null
 */
export async function getRandomCountryWithIpv6(kv, listIpv6Entries) {
  const entries = await listIpv6Entries(kv);
  if (entries.length === 0) return null;
  
  // فقط کشورهایی که موجودی دارند
  const available = entries.filter(e => e.addresses && e.addresses.length > 0);
  if (available.length === 0) return null;
  
  return available[Math.floor(Math.random() * available.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 🤖 Bot Username Cache
// ─────────────────────────────────────────────────────────────────────────────

let botUsernameCache = null;

// ─────────────────────────────────────────────────────────────────────────────
// 👮 Admin Check Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * بررسی اینکه کاربر ادمین گروه است یا خیر
 * @param {Object} env - Environment variables
 * @param {Function} telegramApi - تابع ارتباط با Telegram API
 * @param {number} chatId - شناسه گروه
 * @param {number} userId - شناسه کاربر
 * @returns {boolean} - true اگر کاربر ادمین باشد
 */
async function isUserAdmin(env, telegramApi, chatId, userId) {
  try {
    const res = await telegramApi(env, '/getChatMember', {
      chat_id: chatId,
      user_id: userId
    });
    
    if (res.ok && res.result) {
      const status = res.result.status;
      return status === 'creator' || status === 'administrator';
    }
  } catch (e) {
    console.error('خطا در بررسی ادمین بودن:', e);
  }
  
  return false;
}

/**
 * دریافت username ربات با cache
 * @param {Object} env - Environment variables
 * @param {Function} telegramApi - تابع ارتباط با Telegram API
 * @returns {string} - Username ربات
 */
export async function getBotUsername(env, telegramApi) {
  if (botUsernameCache) return botUsernameCache;
  
  try {
    const res = await telegramApi(env, '/getMe');
    if (res.ok && res.result && res.result.username) {
      botUsernameCache = res.result.username;
      return botUsernameCache;
    }
  } catch (e) {
    console.error('خطا در دریافت username ربات:', e);
  }
  
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// 📋 Group Command Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * دستور /gen_w - تولید WireGuard با لوکیشن رندوم
 * @param {Object} params - پارامترهای مورد نیاز
 * @returns {boolean} - true اگر دستور اجرا شد
 */
export async function handleGenWireGuard(params) {
  const {
    env,
    chat,
    text,
    from,
    telegramApi,
    telegramUpload,
    listDnsEntries,
    randItem,
    randInt,
    generateWireGuardKeys,
    generateWgFilename,
    buildWgConf,
    WG_MTUS,
    WG_FIXED_DNS
  } = params;

  const botUsername = await getBotUsername(env, telegramApi);
  
  // بررسی دستور
  if (text !== '/gen_w' && text !== `/gen_w@${botUsername}`) {
    return false;
  }

  // بررسی ادمین بودن کاربر
  const isAdmin = await isUserAdmin(env, telegramApi, chat, from.id);
  if (!isAdmin) {
    // اگر کاربر ادمین نیست، هیچ پاسخی نمی‌دهیم
    return true;
  }

  const randomCountry = await getRandomCountryWithDns(env.DB, listDnsEntries);
  if (!randomCountry) {
    await telegramApi(env, '/sendMessage', {
      chat_id: chat,
      text: '❌ هیچ کشوری با موجودی موجود نیست!'
    });
    return true;
  }

  const countryCode = randomCountry.code;
  const countryName = randomCountry.name;
  const randomAddress = randItem(randomCountry.addresses);

  // تنظیمات پیش‌فرض
  const mtu = randItem(WG_MTUS);
  const dns = randItem(WG_FIXED_DNS);
  const port = randInt(10000, 65535);
  const keys = await generateWireGuardKeys();
  const filename = generateWgFilename('location', countryCode);

  const conf = buildWgConf({
    privateKey: keys.privateKey,
    addresses: randomAddress,
    mtu: mtu,
    dns: dns,
    listenPort: port
  });

  const blob = new Blob([conf], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('chat_id', String(chat));
  formData.append('document', blob, `${filename}.conf`);
  formData.append('caption', `🌍 *WireGuard - ${countryName}*\n\n📍 لوکیشن: ${countryName}\n🔗 آدرس: \`${randomAddress}\`\n📡 MTU: ${mtu}\n🌐 DNS: ${dns}\n🔌 Port: ${port}`);
  formData.append('parse_mode', 'Markdown');

  await telegramUpload(env, 'sendDocument', formData);
  return true;
}

/**
 * دستور /gen_d - ارسال DNS با لوکیشن رندوم
 * @param {Object} params - پارامترهای مورد نیاز
 * @returns {boolean} - true اگر دستور اجرا شد
 */
export async function handleGenDns(params) {
  const {
    env,
    chat,
    text,
    from,
    telegramApi,
    listDnsEntries,
    countryCodeToFlag
  } = params;

  const botUsername = await getBotUsername(env, telegramApi);
  
  // بررسی دستور
  if (text !== '/gen_d' && text !== `/gen_d@${botUsername}`) {
    return false;
  }

  // بررسی ادمین بودن کاربر
  const isAdmin = await isUserAdmin(env, telegramApi, chat, from.id);
  if (!isAdmin) {
    // اگر کاربر ادمین نیست، هیچ پاسخی نمی‌دهیم
    return true;
  }

  const randomCountry = await getRandomCountryWithDns(env.DB, listDnsEntries);
  if (!randomCountry) {
    await telegramApi(env, '/sendMessage', {
      chat_id: chat,
      text: '❌ هیچ کشوری با موجودی موجود نیست!'
    });
    return true;
  }

  const countryName = randomCountry.name;
  const flag = countryCodeToFlag(randomCountry.code);
  const addresses = randomCountry.addresses || [];
  const stock = addresses.length;

  let dnsMessage = `${flag} *${countryName}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  dnsMessage += `📊 موجودی: ${stock} آدرس\n\n`;
  dnsMessage += `📡 *آدرس‌های IPv4:*\n`;
  addresses.forEach((addr, i) => {
    dnsMessage += `${i + 1}. \`${addr}\`\n`;
  });

  await telegramApi(env, '/sendMessage', {
    chat_id: chat,
    text: dnsMessage,
    parse_mode: 'Markdown'
  });
  return true;
}

/**
 * مدیریت دستورات گروهی
 * @param {Object} params - پارامترهای مورد نیاز
 * @returns {boolean} - true اگر دستور گروهی بود و اجرا شد
 */
export async function handleGroupCommands(params) {
  const { msg } = params;
  
  // بررسی اینکه پیام از گروه است
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return false;
  }

  // دستور /gen_w
  if (await handleGenWireGuard(params)) {
    return true;
  }

  // دستور /gen_d
  if (await handleGenDns(params)) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 👥 my_chat_member Handler - پیام خوش‌آمدگویی
// ─────────────────────────────────────────────────────────────────────────────

/**
 * مدیریت event اضافه شدن ربات به گروه
 * @param {Object} update - Telegram update object
 * @param {Object} env - Environment variables
 * @param {Function} telegramApi - تابع ارتباط با Telegram API
 */
export async function handleMyChatMember(update, env, telegramApi) {
  if (!update.my_chat_member) return;

  const myChatMember = update.my_chat_member;
  const chat = myChatMember.chat;
  const newStatus = myChatMember.new_chat_member?.status;
  const oldStatus = myChatMember.old_chat_member?.status;

  // بررسی اینکه ربات به گروه اضافه شده یا ادمین شده
  if ((chat.type === 'group' || chat.type === 'supergroup') && 
      (oldStatus === 'left' || oldStatus === 'kicked') && 
      (newStatus === 'member' || newStatus === 'administrator')) {
    
    const welcomeMsg = `🎉 *ربات با موفقیت نصب شد!*\n\n` +
      `✅ ربات آماده استفاده است.\n\n` +
      `📋 *دستورات موجود:*\n\n` +
      `🔹 \`/gen_w\` - تولید فایل WireGuard با لوکیشن رندوم\n` +
      `🔹 \`/gen_d\` - دریافت DNS با لوکیشن رندوم\n\n` +
      `💡 این دستورات بدون محدودیت و برای همه اعضای گروه قابل استفاده است.\n\n` +
      `🌍 هر بار که دستور را بزنید، یک کشور تصادفی انتخاب می‌شود!`;

    await telegramApi(env, '/sendMessage', {
      chat_id: chat.id,
      text: welcomeMsg,
      parse_mode: 'Markdown'
    });
  }
}
