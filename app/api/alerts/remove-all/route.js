import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import Alert from "../../../../models/Alert.js";
import AlertRedisService from "../../../../services/AlertRedisService.js";

// DELETE /api/alerts/remove-all - Remove ALL alerts for current user
export async function DELETE(request) {
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

        const userId = decoded.userId;
        console.log(`🗑️ Removing ALL alerts for user ${userId}...`);

        // Delete all alerts for this user from MongoDB
        const deleteResult = await Alert.deleteMany({ userId });
        console.log(`✅ Deleted ${deleteResult.deletedCount} alerts from MongoDB`);

        // Clear Redis alerts cache for this user
        try {
            await AlertsCache.clearUserAlerts(userId);
            console.log(`✅ Cleared Redis alerts cache for user ${userId}`);
        } catch (cacheError) {
            console.warn("⚠️ Error clearing Redis cache:", cacheError.message);
        }

        // 🔥 CRITICAL: Publish Redis event so WORKER receives the message
        try {
            console.log(`📢 Publishing alerts_cleared event for user ${userId}`);
            await AlertRedisService.publishAlertsCleared(userId);
            console.log(`✅ alerts_cleared event published`);
        } catch (publishError) {
            console.warn("⚠️ Error publishing alerts_cleared event:", publishError.message);
        }

        console.log(`✅ All alerts removed for user ${userId}: ${deleteResult.deletedCount} alerts deleted`);

        return NextResponse.json({
            success: true,
            message: `All alerts removed successfully`,
            deletedCount: deleteResult.deletedCount,
        });
    } catch (error) {
        console.error("❌ Error removing all alerts:", error);
        return NextResponse.json(
            { error: "Internal server error", details: error.message },
            { status: 500 }
        );
    }
}
