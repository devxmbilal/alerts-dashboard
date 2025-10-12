import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import Alert from "../../../../models/Alert.js";

// POST /api/alerts/clear - Clear all alerts for user
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

    console.log(`🗑️ Clearing all alerts for user ${decoded.userId}...`);

    // Remove all alerts from MongoDB
    const deleteResult = await Alert.deleteMany({
      userId: decoded.userId,
    });

    // Clear alerts from Redis cache
    await AlertsCache.clearUserAlerts(decoded.userId);

    console.log(`✅ Cleared ${deleteResult.deletedCount} alerts`);

    return NextResponse.json({
      success: true,
      message: `Cleared ${deleteResult.deletedCount} alerts`,
      data: {
        deletedCount: deleteResult.deletedCount,
      },
    });
  } catch (error) {
    console.error("Error clearing alerts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
