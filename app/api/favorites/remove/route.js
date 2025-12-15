import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache, AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import User from "../../../../models/User.js";
import Alert from "../../../../models/Alert.js";
import AlertRedisService from "../../../../services/AlertRedisService.js";

// POST /api/favorites/remove - Remove symbol from favorites
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

    const { symbol } = await request.json();
    if (!symbol) {
      return NextResponse.json(
        { error: "Symbol is required" },
        { status: 400 }
      );
    }

    // Remove symbol from favorites using $pull
    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { $pull: { favorites: symbol } },
      { new: true, select: "favorites" }
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update Redis cache
    await FavoritesCache.setUserFavorites(decoded.userId, user.favorites);

    // Get alerts before deleting (for Redis event)
    const alertsToDelete = await Alert.find({
      userId: decoded.userId,
      symbol: symbol,
    }).select("_id");

    // Remove alerts for this symbol from MongoDB
    const deleteResult = await Alert.deleteMany({
      userId: decoded.userId,
      symbol: symbol,
    });

    // Remove from Redis alerts cache
    await AlertsCache.removeAlert(decoded.userId, symbol);

    // 🔥 CRITICAL: Publish Redis event so WORKER receives the message
    // This notifies alert-worker to stop processing these alerts
    console.log(`📢 Publishing alerts_removed_for_symbol event for ${symbol}`);
    await AlertRedisService.publishAlertsRemovedForSymbol(decoded.userId, symbol);

    // Also publish individual alert removed events for each deleted alert
    for (const alert of alertsToDelete) {
      await AlertRedisService.publishAlertRemoved(
        alert._id.toString(),
        decoded.userId,
        symbol
      );
    }

    console.log(`✅ ${symbol} removed from favorites, ${deleteResult.deletedCount} alerts deleted, events published`);

    return NextResponse.json({
      success: true,
      message: `${symbol} removed from favorites and ${deleteResult.deletedCount} alerts removed`,
      favorites: user.favorites,
      alertsRemoved: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error("Error removing from favorites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
