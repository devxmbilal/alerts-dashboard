import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../utils/mongodb.js";
import AlertService from "../../../services/AlertService.js";

// GET /api/alerts - Get user's alerts
export async function GET(request) {
  try {
    await connectToMongoDB();

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const alerts = await AlertService.getUserAlerts(userId);

    return NextResponse.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}

// POST /api/alerts - Create new alert
export async function POST(request) {
  try {
    await connectToMongoDB();

    const body = await request.json();
    const {
      userId,
      symbol,
      conditions,
      notificationSettings,
      baselinePrice,
      baselineVolume,
    } = body;

    if (!userId || !symbol || !conditions) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Fetch current market data if baseline values not provided
    let currentPrice = baselinePrice;
    let currentVolume = baselineVolume;

    if (!currentPrice || !currentVolume) {
      try {
        // Fetch current price and volume from Binance
        const priceResponse = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
        );
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          currentPrice =
            currentPrice ||
            parseFloat(priceData.lastPrice || priceData.price || 0);
          currentVolume = currentVolume || parseFloat(priceData.volume || 0);
        }
      } catch (error) {
        console.warn(
          `⚠️ Failed to fetch price data for ${symbol}:`,
          error.message
        );
      }
    }
      // Create alert with baseline values
      const alert = await AlertService.createAlert(
        userId,
        symbol,
        conditions,
        notificationSettings,
        currentPrice,
        currentVolume
      );

      return NextResponse.json({
        success: true,
        data: alert,
      });
    } catch (error) {
      console.error("Error creating alert:", error);
      return NextResponse.json(
        { error: "Failed to create alert" },
        { status: 500 }
      );
    }
  }

// PUT /api/alerts - Update alert
export async function PUT(request) {
    try {
      await connectToMongoDB();

      const body = await request.json();
      const { alertId, userId, status } = body;

      if (!alertId || !userId) {
        return NextResponse.json(
          { error: "Missing required fields" },
          { status: 400 }
        );
      }

      const alert = await AlertService.updateAlertStatus(alertId, status);

      if (!alert) {
        return NextResponse.json({ error: "Alert not found" }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        data: alert,
      });
    } catch (error) {
      console.error("Error updating alert:", error);
      return NextResponse.json(
        { error: "Failed to update alert" },
        { status: 500 }
      );
    }
  }

  // DELETE /api/alerts - Delete alert
  export async function DELETE(request) {
    try {
      await connectToMongoDB();

      const { searchParams } = new URL(request.url);
      const alertId = searchParams.get("alertId");
      const userId = searchParams.get("userId");

      if (!alertId || !userId) {
        return NextResponse.json(
          { error: "Missing required fields" },
          { status: 400 }
        );
      }

      const alert = await AlertService.deleteAlert(alertId, userId);

      if (!alert) {
        return NextResponse.json({ error: "Alert not found" }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: "Alert deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting alert:", error);
      return NextResponse.json(
        { error: "Failed to delete alert" },
        { status: 500 }
      );
    }
  }
