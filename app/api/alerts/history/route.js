import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
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

    console.log("🔍 API /api/alerts/history - userId:", userId);
    console.log("🔍 API /api/alerts/history - page:", page, "limit:", limit);

    let alertHistory;

    if (symbol) {
      // Get alert history for specific symbol
      console.log("🔍 Fetching alerts for symbol:", symbol);
      alertHistory = await AlertHistoryService.getSymbolAlertHistory(
        symbol,
        limit,
        (page - 1) * limit
      );
    } else {
      // Get alert history with pagination
      console.log("🔍 Fetching paginated alerts for userId:", userId);
      const result = await AlertHistoryService.getAlertHistoryWithPagination(
        userId,
        page,
        limit
      );
      console.log("🔍 Pagination result:", {
        dataLength: result?.data?.length,
        pagination: result?.pagination
      });
      alertHistory = result.data; // Extract data from pagination result
    }

    console.log("✅ Returning alert history, count:", alertHistory?.length);
    if (alertHistory?.length > 0) {
      console.log("🔍 First alert sample:", {
        id: alertHistory[0]._id,
        symbol: alertHistory[0].symbol,
        triggeredAt: alertHistory[0].triggeredAt,
        hasTriggerData: !!alertHistory[0].triggerData
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
