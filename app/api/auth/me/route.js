import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import UserService from "../../../../services/UserService.js";
import { verifyToken } from "../../../../utils/auth.js";

// GET /api/auth/me - Get current user
export async function GET(request) {
  try {
    await connectToMongoDB();

    // Check authentication
    const authHeader = request.headers.get("authorization");
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return NextResponse.json(
        { error: "Access token required" },
        { status: 401 }
      );
    }

    // Verify token and get user
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 403 }
      );
    }

    const user = await UserService.findById(decoded.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 }
    );
  }
}
