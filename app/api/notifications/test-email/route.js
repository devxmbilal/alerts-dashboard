import { NextResponse } from "next/server";
import EmailService from "../../../../services/EmailService.js";

// POST /api/notifications/test-email - Test email notification
export async function POST(request) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    console.log(`🧪 Testing email notification to ${email}`);

    const success = await EmailService.testEmail(email);

    if (success) {
      return NextResponse.json({
        success: true,
        message: `Test email sent successfully to ${email}`,
      });
    } else {
      return NextResponse.json(
        {
          error: "Failed to send test email. Check server logs for details.",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("❌ Error in test-email endpoint:", error);
    return NextResponse.json(
      { error: "Failed to send test email", details: error.message },
      { status: 500 }
    );
  }
}
