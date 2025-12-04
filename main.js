
const MIGRATION_URL = 'https://free-config.pages.dev/';
const FORCED_CHANNEL = '@ROOTLeaker';

async function tg(token, method, body) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    try {
        return await res.json();
    } catch {
        return { ok: false };
    }
}

function sendMsg(token, chat_id, text, extra = {}) {
    return tg(token, "sendMessage", {
        chat_id,
        text,
        parse_mode: "HTML",
        ...extra,
    });
}

async function checkUserMembership(token, userId, channelId) {
    try {
        const res = await tg(token, 'getChatMember', { 
            chat_id: channelId, 
            user_id: userId 
        });
        if (res.ok && res.result) {
            const status = res.result.status;
            return ['member', 'administrator', 'creator'].includes(status);
        }
        return false;
    } catch (e) {
        console.error('checkUserMembership error:', e);
        return false;
    }
}

export async function handleUpdate(update, env) {
    const token = env.BOT_TOKEN;
    if (!token) {
        console.error("CRITICAL: BOT_TOKEN environment variable is not set");
        throw new Error("BOT_TOKEN is required but not configured");
    }

    try {
        if (!update) return;

        const message = update.message || update.edited_message;
        const callback = update.callback_query;
        const user = (message && message.from && message.from.id) || 
                    (callback && callback.from && callback.from.id);
        const chatId = (message && message.chat && message.chat.id) || 
                      (callback && callback.message && callback.message.chat && callback.message.chat.id);

        if (!chatId) return;

        const chatType = (message && message.chat && message.chat.type) || 
                        (callback && callback.message && callback.message.chat && callback.message.chat.type);
        if (chatType && chatType !== 'private') {
            return;
        }

        if (callback) {
            const data = callback.data || "";

            tg(token, "answerCallbackQuery", {
                callback_query_id: callback.id,
            }).catch(() => {});

            if (data === "check_membership") {
                const isMember = await checkUserMembership(token, user, FORCED_CHANNEL);

                if (isMember) {
                    await sendMsg(token, chatId,
                        `✅ <b>عضویت شما تایید شد!</b>

━━━━━━━━━━━━━━━━━━━━

📢 <b>اطلاعیه مهاجرت</b>

سرویس ما به یک پلتفرم جدید و بهتر مهاجرت کرده است.

🌐 برای دریافت کانفیگ‌های رایگان، لطفاً از لینک زیر به سایت جدید ما مراجعه کنید:

━━━━━━━━━━━━━━━━━━━━

✨ امکانات جدید:
• رابط کاربری بهتر
• سرعت بیشتر
• سرورهای متنوع‌تر
• پشتیبانی قوی‌تر

💚 از صبر و همراهی شما متشکریم!`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ 
                                    text: "🌐 ورود به سایت جدید", 
                                    url: MIGRATION_URL 
                                }]
                            ]
                        }
                    });
                } else {
                    await sendMsg(token, chatId,
                        "❌ هنوز در کانال عضو نشده‌اید!\n\nلطفاً ابتدا در کانال عضو شوید و سپس دوباره تلاش کنید.", {
                        reply_markup: {
                            inline_keyboard: [
                                [{ 
                                    text: "📢 عضویت در کانال", 
                                    url: `https://t.me/${FORCED_CHANNEL.replace('@', '')}` 
                                }],
                                [{ 
                                    text: "✅ عضو شدم", 
                                    callback_data: "check_membership" 
                                }]
                            ]
                        }
                    });
                }
                return;
            }
            return;
        }

        const text = message && message.text ? message.text.trim() : "";

        if (text === "/start") {
            const isMember = await checkUserMembership(token, user, FORCED_CHANNEL);

            if (isMember) {
                await sendMsg(token, chatId,
                    `✅ <b>خوش آمدید!</b>

━━━━━━━━━━━━━━━━━━━━

📢 <b>اطلاعیه مهاجرت</b>

سرویس ما به یک پلتفرم جدید و بهتر مهاجرت کرده است.

🌐 برای دریافت کانفیگ‌های رایگان، لطفاً از لینک زیر به سایت جدید ما مراجعه کنید:

━━━━━━━━━━━━━━━━━━━━

✨ امکانات جدید:
• رابط کاربری بهتر
• سرعت بیشتر
• سرورهای متنوع‌تر
• پشتیبانی قوی‌تر

💚 از صبر و همراهی شما متشکریم!`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ 
                                text: "🌐 ورود به سایت جدید", 
                                url: MIGRATION_URL 
                            }]
                        ]
                    }
                });
            } else {
                await sendMsg(token, chatId,
                    `👋 <b>سلام!</b>

━━━━━━━━━━━━━━━━━━━━

⚠️ برای استفاده از ربات، ابتدا باید در کانال ما عضو شوید:

📢 <b>کانال:</b> ${FORCED_CHANNEL}

━━━━━━━━━━━━━━━━━━━━

پس از عضویت، روی دکمه "✅ عضو شدم" کلیک کنید.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ 
                                text: "📢 عضویت در کانال", 
                                url: `https://t.me/${FORCED_CHANNEL.replace('@', '')}` 
                            }],
                            [{ 
                                text: "✅ عضو شدم", 
                                callback_data: "check_membership" 
                            }]
                        ]
                    }
                });
            }
            return;
        }

        if (text === "/id") {
            await sendMsg(token, chatId,
                `🆔 <b>آیدی عددی شما:</b>\n<code>${user}</code>\n\n` +
                `از این آیدی برای ورود به سایت استفاده کنید.\n\n` +
                `🌐 <b>لینک سایت:</b>\n${MIGRATION_URL}`
            );
            return;
        }

        await sendMsg(token, chatId, 
            "❓ <b>دستورات موجود:</b>\n\n" +
            "/start - شروع ربات\n" +
            "/id - دریافت آیدی عددی\n\n" +
            "🌐 برای دریافت کانفیگ‌ها لطفاً از سایت استفاده کنید."
        );

    } catch (err) {
        console.error("handleUpdate error:", err);
        console.error("Error stack:", err.stack);
    }
}

const app = {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path === "/webhook" && request.method === "POST") {
            try {
                const update = await request.json();
                await handleUpdate(update, env);
                return new Response("OK", { status: 200 });
            } catch (e) {
                console.error("Webhook error:", e);
                return new Response("Error", { status: 500 });
            }
        }

        return new Response("Telegram Bot - Active", { status: 200 });
    },
};

export default app;
