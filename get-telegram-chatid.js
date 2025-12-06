/**
 * 🔍 GET TELEGRAM CHAT ID HELPER
 * 
 * This script helps you find your Telegram Chat ID
 */

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";

console.log("\n🔍 ========================================");
console.log("   GET YOUR TELEGRAM CHAT ID");
console.log("========================================\n");

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
    console.error("❌ TELEGRAM_BOT_TOKEN not found in .env file!");
    process.exit(1);
}

console.log("✅ Bot Token found");
console.log(`📱 Bot Token: ${botToken.substring(0, 20)}...\n`);

async function getChatId() {
    try {
        console.log("📡 Fetching recent updates from Telegram...\n");

        const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
        const response = await axios.get(url);

        if (response.data.ok && response.data.result.length > 0) {
            console.log("✅ Found recent messages!\n");
            console.log("📋 Recent Chats:");
            console.log("========================================\n");

            const chats = new Map();

            response.data.result.forEach((update, index) => {
                if (update.message) {
                    const chat = update.message.chat;
                    const from = update.message.from;
                    const text = update.message.text || "(media/file)";

                    if (!chats.has(chat.id)) {
                        chats.set(chat.id, {
                            id: chat.id,
                            type: chat.type,
                            first_name: from.first_name || chat.first_name,
                            username: from.username || chat.username,
                            last_message: text,
                        });
                    }
                }
            });

            let chatNumber = 1;
            for (const [chatId, chatInfo] of chats) {
                console.log(`Chat #${chatNumber}:`);
                console.log(`   Chat ID: ${chatInfo.id}`);
                console.log(`   Type: ${chatInfo.type}`);
                console.log(`   Name: ${chatInfo.first_name || "N/A"}`);
                console.log(`   Username: @${chatInfo.username || "N/A"}`);
                console.log(`   Last Message: "${chatInfo.last_message}"`);
                console.log("");
                chatNumber++;
            }

            console.log("========================================\n");
            console.log("💡 To use a Chat ID, run:");
            console.log("   node demo-telegram-alert.js CHAT_ID\n");
            console.log("Example:");
            console.log(`   node demo-telegram-alert.js ${Array.from(chats.keys())[0]}\n`);

        } else {
            console.log("⚠️ No recent messages found!\n");
            console.log("💡 To get your Chat ID:");
            console.log("   1. Open Telegram");
            console.log("   2. Search for your bot by username");
            console.log("   3. Send any message to the bot");
            console.log("   4. Run this script again\n");
            console.log("🤖 Bot Info:");

            // Get bot info
            const botInfoUrl = `https://api.telegram.org/bot${botToken}/getMe`;
            const botInfoResponse = await axios.get(botInfoUrl);

            if (botInfoResponse.data.ok) {
                const bot = botInfoResponse.data.result;
                console.log(`   Bot Name: ${bot.first_name}`);
                console.log(`   Username: @${bot.username}`);
                console.log(`   Bot ID: ${bot.id}\n`);
                console.log(`📱 Search for @${bot.username} on Telegram and send a message!\n`);
            }
        }

    } catch (error) {
        console.error("❌ Error fetching chat ID:", error.message);
        if (error.response) {
            console.error("API Response:", error.response.data);
        }
    }
}

getChatId();
