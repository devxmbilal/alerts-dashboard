import { NextResponse } from "next/server";
import { FavoritesCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import { verifyToken } from "../../../../utils/auth.js";

// POST /api/auth/logout - Logout user and clear cache
export async function POST(request) {
  try {
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

    // Clear user's favorites cache
    await FavoritesCache.clearUserFavorites(decoded.userId);

    return NextResponse.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Error during logout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
