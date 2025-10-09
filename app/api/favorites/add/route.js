import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import User from "../../../../models/User.js";

// POST /api/favorites/add - Add symbol to favorites
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

    // Add symbol to favorites using $addToSet to prevent duplicates
    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { $addToSet: { favorites: symbol } },
      { new: true, select: "favorites" }
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update Redis cache
    await FavoritesCache.setUserFavorites(decoded.userId, user.favorites);

    return NextResponse.json({
      success: true,
      message: `${symbol} added to favorites`,
      favorites: user.favorites,
    });
  } catch (error) {
    console.error("Error adding to favorites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
