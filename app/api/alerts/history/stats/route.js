import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../../utils/mongodb.js";
import AlertHistoryService from "../../../../../services/AlertHistoryService.js";

// GET /api/alerts/history/stats - Get alert history statistics
export async function GET(request) {
  try {
    await connectToMongoDB();

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const hours = parseInt(searchParams.get("hours")) || 24;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const [stats, recentAlerts] = await Promise.all([
      AlertHistoryService.getAlertHistoryStats(userId),
      AlertHistoryService.getRecentAlertHistory(userId, hours),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        stats,
        recentAlerts,
      },
    });
  } catch (error) {
    console.error("Error fetching alert history stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch alert history stats" },
      { status: 500 }
    );
  }
}
