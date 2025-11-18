import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import AlertHistoryService from "../../../../services/AlertHistoryService.js";

// GET /api/alerts/latest-triggered - Get the latest triggered alert for chart switching
export async function GET(request) {
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

    const userId = decoded.userId;

    // Get the latest triggered alert for the user
    const latestAlert = await AlertHistoryService.getLatestTriggeredAlert(
      userId
    );

    if (!latestAlert) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "No triggered alerts found",
      });
    }

    // Format the response for chart switching
    const chartData = {
      symbol: latestAlert.symbol,
      price: latestAlert.triggerData?.price || 0,
      priceChangePercent: latestAlert.triggerData?.priceChangePercent || 0,
      triggeredAt: latestAlert.triggeredAt,
      conditions: latestAlert.conditions,
      baselinePrice: latestAlert.baselineData?.baselinePrice,
      changeFromBaselinePercent:
        latestAlert.baselineData?.changeFromBaselinePercent,
      volume: latestAlert.triggerData?.volume24h || 0,
    };

    return NextResponse.json({
      success: true,
      data: chartData,
      message: "Latest triggered alert retrieved successfully",
    });
  } catch (error) {
    console.error("❌ Error fetching latest triggered alert:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest triggered alert" },
      { status: 500 }
    );
  }
}
