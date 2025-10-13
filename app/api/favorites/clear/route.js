import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache, AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import User from "../../../../models/User.js";
import Alert from "../../../../models/Alert.js";
import RealTimeAlertProcessor from "../../../../services/RealTimeAlertProcessor.js";

// POST /api/favorites/clear - Remove ALL favorites and their alerts
export async function POST(request) {
  try {
    await connectToMongoDB();

    // Initialize Redis (optional - continue if it fails)
    try {
      await initializeRedis();
    } catch (redisError) {
      console.warn(
        "⚠️ Redis initialization failed, continuing without cache:",
        redisError.message
      );
    }

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

    console.log("🧹 Clearing ALL favorites for user:", decoded.userId);

    // Get current favorites to know how many we're removing
    const user = await User.findById(decoded.userId, "favorites");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentFavorites = user.favorites || [];
    console.log("📊 Current favorites count:", currentFavorites.length);

    if (currentFavorites.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No favorites to clear",
        favorites: [],
        count: 0,
        alertsRemoved: 0,
      });
    }

    // Clear ALL favorites from user document
    const updatedUser = await User.findByIdAndUpdate(
      decoded.userId,
      { $set: { favorites: [] } }, // Set favorites to empty array
      { new: true, select: "favorites" }
    );

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Clear Redis favorites cache
    try {
      await FavoritesCache.clearUserFavorites(decoded.userId);
      console.log("✅ Cleared favorites from Redis cache");
    } catch (cacheError) {
      console.warn("⚠️ Error clearing favorites cache:", cacheError.message);
    }

    // Remove ALL alerts for this user
    let alertsRemoved = 0;
    try {
      const deleteResult = await Alert.deleteMany({
        userId: decoded.userId,
      });
      alertsRemoved = deleteResult.deletedCount;
      console.log("✅ Removed all alerts:", alertsRemoved);
    } catch (alertError) {
      console.error("❌ Error removing alerts:", alertError);
    }

    // Clear Redis alerts cache
    try {
      await AlertsCache.clearUserAlerts(decoded.userId);
      console.log("✅ Cleared alerts from Redis cache");
    } catch (cacheError) {
      console.warn("⚠️ Error clearing alerts cache:", cacheError.message);
    }

    // Notify RealTimeAlertProcessor to stop processing all alerts for this user
    try {
      await RealTimeAlertProcessor.removeAlertsForUser(decoded.userId);
      console.log(
        "✅ Notified RealTimeAlertProcessor to stop processing alerts"
      );
    } catch (processorError) {
      console.warn(
        "⚠️ Error notifying RealTimeAlertProcessor:",
        processorError.message
      );
    }

    console.log(
      `✅ Cleared ALL favorites: ${currentFavorites.length} favorites and ${alertsRemoved} alerts removed`
    );

    return NextResponse.json({
      success: true,
      message: `Cleared ALL favorites: ${currentFavorites.length} favorites and ${alertsRemoved} alerts removed`,
      favorites: [],
      count: currentFavorites.length,
      alertsRemoved: alertsRemoved,
    });
  } catch (error) {
    console.error("❌ Error clearing all favorites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
