import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import User from "../../../../models/User.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// PUT /api/user/settings - Update user settings
export async function PUT(request) {
  try {
    await connectToMongoDB();

    // Get token from header
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    // Get update data
    const updateData = await request.json();
    const {
      name,
      email,
      currentPassword,
      newPassword,
      telegramChatId,
      telegramBotToken,
      notificationPreferences,
      preferredTimeframe,
    } = updateData;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Validate email if provided
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: userId } });
      if (emailExists) {
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 400 }
        );
      }
      user.email = email;
    }

    // Update name if provided
    if (name && name !== user.name) {
      user.name = name;
    }

    // Update password if provided
    if (newPassword) {
      // Verify current password
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required" },
          { status: 400 }
        );
      }

      const isValidPassword = await bcrypt.compare(
        currentPassword,
        user.password
      );
      if (!isValidPassword) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 400 }
        );
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
    }

    // Update Telegram Chat ID if provided
    if (telegramChatId !== undefined) {
      // Validate numeric
      if (telegramChatId && !/^\d+$/.test(telegramChatId)) {
        return NextResponse.json(
          { error: "Telegram Chat ID must be numeric" },
          { status: 400 }
        );
      }
      user.telegramChatId = telegramChatId;
    }

    // Update Telegram Bot Token if provided
    if (telegramBotToken !== undefined) {
      user.telegramBotToken = telegramBotToken;
    }

    // Update notification preferences if provided
    if (notificationPreferences) {
      user.notificationPreferences = {
        email:
          notificationPreferences.email ??
          user.notificationPreferences?.email ??
          true,
        telegram:
          notificationPreferences.telegram ??
          user.notificationPreferences?.telegram ??
          false,
      };
    }

    // Update preferred timeframe if provided
    if (preferredTimeframe) {
      const validTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
      if (validTimeframes.includes(preferredTimeframe)) {
        user.preferredTimeframe = preferredTimeframe;
        console.log(`✅ Updated preferred timeframe to: ${preferredTimeframe}`);
      } else {
        return NextResponse.json(
          {
            error: "Invalid timeframe. Must be one of: 1m, 5m, 15m, 1h, 4h, 1d",
          },
          { status: 400 }
        );
      }
    }

    // Save updated user
    await user.save();

    // Return updated user (without password)
    const userResponse = {
      _id: user._id,
      username: user.username,
      name: user.name,
      email: user.email,
      telegramChatId: user.telegramChatId,
      telegramBotToken: user.telegramBotToken ? '***configured***' : null,
      notificationPreferences: user.notificationPreferences,
      preferredTimeframe: user.preferredTimeframe,
    };

    console.log(`✅ User settings updated for ${user.username}`);

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
      user: userResponse,
    });
  } catch (error) {
    console.error("❌ Error updating user settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings", details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/user/settings - Get current user settings
export async function GET(request) {
  try {
    await connectToMongoDB();

    // Get token from header
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    // Find user
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        telegramChatId: user.telegramChatId,
        telegramBotToken: user.telegramBotToken ? '***configured***' : null,
        notificationPreferences: user.notificationPreferences,
        preferredTimeframe: user.preferredTimeframe,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching user settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings", details: error.message },
      { status: 500 }
    );
  }
}
