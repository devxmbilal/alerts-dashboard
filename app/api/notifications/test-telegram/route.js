import { NextResponse } from "next/server";
import TelegramService from "../../../../services/TelegramService.js";

// POST /api/notifications/test-telegram - Test Telegram notification
export async function POST(request) {
  try {
    const body = await request.json();
    const { chatId } = body;

    if (!chatId) {
      return NextResponse.json(
        { error: "chatId is required" },
        { status: 400 }
      );
    }

    console.log(`🧪 Testing Telegram notification to chat ${chatId}`);

    const success = await TelegramService.testTelegram(chatId);

    if (success) {
      return NextResponse.json({
        success: true,
        message: `Test Telegram message sent successfully to chat ${chatId}`,
      });
    } else {
      return NextResponse.json(
        {
          error:
            "Failed to send test Telegram message. Check server logs for details.",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("❌ Error in test-telegram endpoint:", error);
    return NextResponse.json(
      {
        error: "Failed to send test Telegram message",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
