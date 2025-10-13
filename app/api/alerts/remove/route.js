import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import Alert from "../../../../models/Alert.js";

// POST /api/alerts/remove - Remove alerts for specific symbols
export async function POST(request) {
  try {
    await connectToMongoDB();
    await initializeRedis();

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

    const { symbols } = await request.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json(
        { error: "Symbols array is required" },
        { status: 400 }
      );
    }

    console.log(`🗑️ Removing alerts for ${symbols.length} symbols...`);

    // Get alert IDs before deleting (for monitoring removal)
    const alertsToDelete = await Alert.find({
      userId: decoded.userId,
      symbol: { $in: symbols },
    }).select("_id");

    // Remove alerts from real-time monitoring first
    try {
      const RealTimeAlertProcessor = (
        await import("../../../../services/RealTimeAlertProcessor.js")
      ).default;

      for (const alert of alertsToDelete) {
        await RealTimeAlertProcessor.removeAlert(alert._id.toString());
      }

      console.log(
        `✅ Removed ${alertsToDelete.length} alerts from real-time monitoring`
      );
    } catch (monitoringError) {
      console.error(
        "❌ Error removing alerts from monitoring:",
        monitoringError
      );
      // Don't fail the API call if monitoring fails
    }

    // Remove alerts from MongoDB
    const deleteResult = await Alert.deleteMany({
      userId: decoded.userId,
      symbol: { $in: symbols },
    });

    // Remove alerts from Redis cache
    await AlertsCache.removeAlerts(decoded.userId, symbols);

    console.log(`✅ Removed ${deleteResult.deletedCount} alerts`);

    return NextResponse.json({
      success: true,
      message: `Removed ${deleteResult.deletedCount} alerts`,
      data: {
        deletedCount: deleteResult.deletedCount,
        symbols: symbols,
      },
    });
  } catch (error) {
    console.error("Error removing alerts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
