import TelegramService from "../services/TelegramService.js";
import dotenv from "dotenv";
dotenv.config();

// Test Telegram service with demo data
async function testTelegramDemo() {
  console.log("🚀 Testing Telegram Service Demo...");
  console.log("=" * 50);

  // Check environment variables
  console.log("🔍 Environment Check:");
  console.log(
    "TELEGRAM_BOT_TOKEN:",
    process.env.TELEGRAM_BOT_TOKEN ? "✅ Set" : "❌ Not set"
  );

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("\n❌ TELEGRAM_BOT_TOKEN not set!");
    console.log(
      "Please set your Telegram bot token in the environment variables."
    );
    console.log(
      "Example: TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
    );
    process.exit(1);
  }

  // Initialize Telegram service
  console.log("\n🔧 Initializing Telegram Service...");
  TelegramService.initialize();

  // Test bot info
  console.log("\n🤖 Getting Bot Info...");
  try {
    const botInfo = await TelegramService.getBotInfo();
    if (botInfo) {
      console.log("✅ Bot Info:", {
        id: botInfo.id,
        username: botInfo.username,
        first_name: botInfo.first_name,
        can_join_groups: botInfo.can_join_groups,
        can_read_all_group_messages: botInfo.can_read_all_group_messages,
        supports_inline_queries: botInfo.supports_inline_queries,
      });
    } else {
      console.log("❌ Failed to get bot info - Bot token might be invalid");
    }
  } catch (error) {
    console.log("⚠️ Network error getting bot info:", error.message);
    console.log("Continuing with message test...");
  }

  // Demo alert data (same as real alert)
  const demoAlertData = {
    symbol: "HEIUSDT",
    targetValue: "0.2",
    actualValue: 0.452,
    direction: "Increase",
    timeframe: "5MIN",
    triggeredPrice: 0.2446,
    baselinePrice: 0.2435,
    changeFromBaselinePercent: 0.452,
    volume: 5733886.8,
    triggeredAt: new Date(),
  };

  // Test chat ID (admin user's chat ID from database)
  //const testChatId = "5630545835";
  const testChatId = "5550226808";

  console.log("\n📱 Sending Demo Alert Message...");
  console.log("Chat ID:", testChatId);
  console.log("Alert Data:", demoAlertData);

  try {
    const result = await TelegramService.sendAlertMessage(
      testChatId,
      demoAlertData
    );

    if (result) {
      console.log("\n✅ SUCCESS! Telegram message sent successfully!");
      console.log("Check your Telegram chat for the alert message.");
    } else {
      console.log("\n❌ FAILED! Could not send Telegram message");
      console.log("Check your bot token and chat ID.");
    }
  } catch (error) {
    console.error("\n❌ ERROR sending Telegram message:", error);
  }

  console.log("\n" + "=" * 50);
  console.log("🏁 Telegram Demo Test Complete!");
  process.exit(0);
}

// Run the test
testTelegramDemo().catch((error) => {
  console.error("❌ Demo test failed:", error);
  process.exit(1);
});
