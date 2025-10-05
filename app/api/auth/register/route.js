import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import UserService from "../../../../services/UserService.js";
import { generateToken } from "../../../../utils/auth.js";

// POST /api/auth/register - User registration
export async function POST(request) {
  try {
    await connectToMongoDB();

    const body = await request.json();
    const { username, password, name, email } = body;

    if (!username || !password || !name || !email) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await UserService.findByUsername(username);
    if (existingUser) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existingEmail = await UserService.findByEmail(email);
    if (existingEmail) {
      return NextResponse.json(
        { error: "Email already exists" },
        { status: 400 }
      );
    }

    // Create new user
    const user = await UserService.createUser({
      username,
      password,
      name,
      email,
    });

    // Generate JWT token
    const token = generateToken(user._id);

    // Return user data and token
    return NextResponse.json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error("Error during registration:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
