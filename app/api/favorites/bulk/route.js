import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import User from "../../../../models/User.js";

// POST /api/favorites/bulk - Bulk add/remove favorites
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

    const { symbols, action } = await request.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json(
        { error: "Symbols array is required" },
        { status: 400 }
      );
    }

    if (!action || !["add", "remove"].includes(action)) {
      return NextResponse.json(
        { error: "Action must be 'add' or 'remove'" },
        { status: 400 }
      );
    }

    let user;
    let updatedFavorites;

    if (action === "add") {
      // Add all symbols to favorites using $addToSet to prevent duplicates
      user = await User.findByIdAndUpdate(
        decoded.userId,
        { $addToSet: { favorites: { $each: symbols } } },
        { new: true, select: "favorites" }
      );
    } else {
      // Remove all symbols from favorites using $pull
      user = await User.findByIdAndUpdate(
        decoded.userId,
        { $pull: { favorites: { $in: symbols } } },
        { new: true, select: "favorites" }
      );
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    updatedFavorites = user.favorites || [];

    // Update Redis cache
    await FavoritesCache.setUserFavorites(decoded.userId, updatedFavorites);

    return NextResponse.json({
      success: true,
      message: `${symbols.length} symbols ${
        action === "add" ? "added to" : "removed from"
      } favorites`,
      favorites: updatedFavorites,
      count: symbols.length,
    });
  } catch (error) {
    console.error("Error in bulk favorites operation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
