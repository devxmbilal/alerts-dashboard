import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import UserService from "../../../../services/UserService.js";
import { generateToken } from "../../../../utils/auth.js";

// POST /api/auth/login - User login
export async function POST(request) {
  try {
    await connectToMongoDB();

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    // Authenticate user
    const authResult = await UserService.authenticateUser(username, password);

    if (!authResult.success) {
      return NextResponse.json({ error: authResult.message }, { status: 401 });
    }

    // Generate JWT token
    const token = generateToken(authResult.user._id);

    // Return user data and token
    return NextResponse.json({
      success: true,
      data: {
        user: authResult.user,
        token,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
