import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import RealTimeAlertProcessor from "../../../../services/RealTimeAlertProcessor.js";

// POST /api/alerts/reset-baseline - Reset alert baselines when conditions change
export async function POST(request) {
  try {
    await connectToMongoDB();

    // Get token from Authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authorization token required" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { alertId, symbol } = await request.json();

    if (alertId && symbol) {
      // Reset specific alert baseline
      RealTimeAlertProcessor.resetAlertBaseline(alertId, symbol);
      console.log(`🔄 Reset baseline for alert ${alertId} (${symbol})`);

      return NextResponse.json({
        success: true,
        message: `Baseline reset for alert ${alertId}`,
        data: { alertId, symbol },
      });
    } else {
      // Reset all baselines
      RealTimeAlertProcessor.resetAllBaselines();
      console.log(`🔄 Reset all alert baselines`);

      return NextResponse.json({
        success: true,
        message: "All alert baselines reset",
        data: { resetAll: true },
      });
    }
  } catch (error) {
    console.error("Error resetting alert baselines:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

