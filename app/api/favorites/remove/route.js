import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache, AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import User from "../../../../models/User.js";
import Alert from "../../../../models/Alert.js";
import RealTimeAlertProcessor from "../../../../services/RealTimeAlertProcessor.js";

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

    // Remove alerts for this symbol
    const deleteResult = await Alert.deleteMany({
      userId: decoded.userId,
      symbol: symbol,
    });

    // Remove from Redis alerts cache
    await AlertsCache.removeAlert(decoded.userId, symbol);

    // Notify RealTimeAlertProcessor to stop processing alerts for this symbol
    await RealTimeAlertProcessor.removeAlertsForSymbol(symbol);

    // Force refresh alerts to ensure worker has latest data
    await RealTimeAlertProcessor.forceRefreshAlerts();

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
