import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache, AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import { calculateLockTime } from "../../../../utils/alertLock.js";
import Alert from "../../../../models/Alert.js";
import RealTimeAlertProcessor from "../../../../services/RealTimeAlertProcessor.js";

// POST /api/alerts/bulk - Create alerts for all favorite pairs
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

    const { conditions, notificationSettings } = await request.json();

    if (!conditions) {
      return NextResponse.json(
        { error: "Conditions are required" },
        { status: 400 }
      );
    }

    // Validate required conditions

    if (
      !conditions.minDaily ||
      !conditions.changePercent?.timeframe ||
      !conditions.changePercent?.percentage
    ) {
      return NextResponse.json(
        {
          error: "Min Daily and Change % conditions are required",
          details: {
            minDaily: conditions.minDaily,
            changePercent: conditions.changePercent,
          },
        },
        { status: 400 }
      );
    }

    // Get user's favorites from Redis cache or API
    let favoriteSymbols = null;

    try {
      favoriteSymbols = await FavoritesCache.getUserFavorites(decoded.userId);
    } catch (cacheError) {
      console.warn(
        "⚠️ Redis cache error, fetching from API:",
        cacheError.message
      );
    }

    if (!favoriteSymbols) {
      // Cache miss - get from API
      const response = await fetch(
        `${request.nextUrl.origin}/api/favorites/list`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        favoriteSymbols = data.favorites || [];
      } else {
        return NextResponse.json(
          { error: "Failed to get favorites" },
          { status: 400 }
        );
      }
    }

    if (favoriteSymbols.length === 0) {
      return NextResponse.json(
        {
          error:
            "No favorite pairs found. Please add some pairs to favorites first.",
        },
        { status: 400 }
      );
    }

    // Prepare alert documents for bulk insert
    const alertDocuments = favoriteSymbols.map((symbol) => {
      let alertConditions = { ...conditions };

      // If alert count is set, calculate initial lock time
      if (conditions.alertCount && conditions.alertCount.timeframe) {
        try {
          const lockUntil = calculateLockTime(conditions.alertCount.timeframe);
          alertConditions = {
            ...alertConditions,
            alertCount: {
              ...alertConditions.alertCount,
              lockUntil: lockUntil,
              lastTriggered: null,
            },
          };
        } catch (error) {
          console.error(`❌ Error calculating lock time for ${symbol}:`, error);
        }
      }

      return {
        symbol: symbol,
        userId: decoded.userId,
        conditions: alertConditions,
        status: "active",
        triggered: false,
        notificationSettings: notificationSettings || {
          email: false,
          telegram: false,
          webhook: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    // No need to remove undefined conditions since we only pass set conditions

    // Delete existing alerts for these symbols first
    try {
      await Alert.deleteMany({
        userId: decoded.userId,
        symbol: { $in: favoriteSymbols },
      });
    } catch (deleteError) {
      console.error("❌ Error deleting existing alerts:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete existing alerts" },
        { status: 500 }
      );
    }

    // Bulk insert new alerts
    let createdAlerts;
    try {
      createdAlerts = await Alert.insertMany(alertDocuments);
    } catch (insertError) {
      console.error("❌ Error inserting alerts:", insertError);
      return NextResponse.json(
        { error: "Failed to create alerts in database" },
        { status: 500 }
      );
    }

    // Update Redis cache with new alerts (optional)
    try {
      const alertCacheData = createdAlerts.map((alert) => ({
        id: alert._id.toString(),
        symbol: alert.symbol,
        userId: alert.userId,
        conditions: alert.conditions,
        status: alert.status,
        triggered: alert.triggered,
        createdAt: alert.createdAt,
        updatedAt: alert.updatedAt,
      }));

      await AlertsCache.bulkUpdateAlerts(decoded.userId, alertCacheData);
    } catch (cacheError) {
      console.warn(
        "⚠️ Redis cache update failed, continuing:",
        cacheError.message
      );
    }

    // Force refresh alerts to ensure worker has latest data
    try {
      await RealTimeAlertProcessor.forceRefreshAlerts();
    } catch (refreshError) {
      console.warn("⚠️ Error refreshing alerts:", refreshError.message);
    }

    return NextResponse.json({
      success: true,
      message: `Alerts created for ${createdAlerts.length} favorite pairs`,
      data: {
        count: createdAlerts.length,
        symbols: favoriteSymbols,
        alerts: createdAlerts.map((alert) => ({
          id: alert._id,
          symbol: alert.symbol,
          status: alert.status,
          conditions: alert.conditions,
        })),
      },
    });
  } catch (error) {
    console.error("❌ Error creating bulk alerts:", error);
    console.error("❌ Error stack:", error.stack);
    console.error("❌ Error details:", {
      message: error.message,
      name: error.name,
      code: error.code,
    });

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
        type: error.name,
      },
      { status: 500 }
    );
  }
}
