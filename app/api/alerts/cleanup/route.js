import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import AlertHistoryService from "../../../../services/AlertHistoryService.js";

// POST /api/alerts/cleanup - Clean up old alert history entries (older than 24 hours)
export async function POST(request) {
  try {
    await connectToMongoDB();

    console.log("🧹 Starting alert history cleanup...");

    const deletedCount = await AlertHistoryService.cleanupOldAlerts();

    console.log(`✅ Cleanup completed. Deleted ${deletedCount} old entries`);

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${deletedCount} old alert history entries`,
      data: { deletedCount },
    });
  } catch (error) {
    console.error("❌ Error during alert cleanup:", error);
    return NextResponse.json(
      { error: "Failed to cleanup old alerts" },
      { status: 500 }
    );
  }
}
