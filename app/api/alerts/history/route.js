import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import AlertHistoryService from "../../../../services/AlertHistoryService.js";

// GET /api/alerts/history - Get alert history for a user
export async function GET(request) {
  try {
    await connectToMongoDB();

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const page = parseInt(searchParams.get("page")) || 1;
    const limit = parseInt(searchParams.get("limit")) || 20;
    const symbol = searchParams.get("symbol");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    let alertHistory;

    if (symbol) {
      // Get alert history for specific symbol
      alertHistory = await AlertHistoryService.getSymbolAlertHistory(
        symbol,
        limit,
        (page - 1) * limit
      );
    } else {
      // Get alert history with pagination
      const result = await AlertHistoryService.getAlertHistoryWithPagination(
        userId,
        page,
        limit
      );
      console.log("🔍 Pagination result:", {
        dataLength: result?.data?.length,
        pagination: result?.pagination,
      });
      alertHistory = result.data; // Extract data from pagination result
    }

    if (alertHistory?.length > 0) {
      console.log("🔍 First alert sample:", {
        id: alertHistory[0]._id,
        symbol: alertHistory[0].symbol,
        triggeredAt: alertHistory[0].triggeredAt,
        hasTriggerData: !!alertHistory[0].triggerData,
      });
    }

    return NextResponse.json({
      success: true,
      data: alertHistory,
    });
  } catch (error) {
    console.error("Error fetching alert history:", error);
    return NextResponse.json(
      { error: "Failed to fetch alert history" },
      { status: 500 }
    );
  }
}

// PUT /api/alerts/history - Update alert history status
export async function PUT(request) {
  try {
    await connectToMongoDB();

    const body = await request.json();
    const { historyId, userId, status } = body;

    if (!historyId || !userId || !status) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const alertHistory = await AlertHistoryService.updateAlertHistoryStatus(
      historyId,
      status,
      userId
    );

    if (!alertHistory) {
      return NextResponse.json(
        { error: "Alert history not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: alertHistory,
    });
  } catch (error) {
    console.error("Error updating alert history:", error);
    return NextResponse.json(
      { error: "Failed to update alert history" },
      { status: 500 }
    );
  }
}

// DELETE /api/alerts/history - Clear all alert history for a user
export async function DELETE(request) {
  try {
    await connectToMongoDB();

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

    console.log(`🗑️ Clearing all alert history for user ${decoded.userId}...`);

    // Clear all alert history for the user
    const result = await AlertHistoryService.clearUserAlertHistory(
      decoded.userId
    );

    console.log(`✅ Cleared ${result.deletedCount} alert history records`);

    return NextResponse.json({
      success: true,
      message: `Cleared ${result.deletedCount} alert history records`,
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (error) {
    console.error("Error clearing alert history:", error);
    return NextResponse.json(
      { error: "Failed to clear alert history" },
      { status: 500 }
    );
  }
}
