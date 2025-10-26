import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import User from "../../../../models/User.js";

// GET /api/favorites/list - Get all favorites for user
export async function GET(request) {
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

    // Try to get favorites from Redis cache first
    let favorites = await FavoritesCache.getUserFavorites(decoded.userId);

    if (!favorites) {
      // Cache miss - get from MongoDB and update cache
      const user = await User.findById(decoded.userId).select("favorites");
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      favorites = user.favorites || [];
      // Update cache for next time
      await FavoritesCache.setUserFavorites(decoded.userId, favorites);
    }

    return NextResponse.json({
      success: true,
      favorites: favorites,
    });
  } catch (error) {
    console.error("Error fetching favorites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
