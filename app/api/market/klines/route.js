import { NextResponse } from "next/server";

// Binance API base URL
const BINANCE_API = "https://api.binance.com/api/v3";

// Map timeframes to Binance intervals
const getBinanceInterval = (timeframe) => {
  switch (timeframe) {
    case "1m": return "1m";
    case "5m": return "5m";
    case "15m": return "15m";
    case "1h": return "1h";
    case "4h": return "4h";
    case "1d": return "1d";
    default: return "1h";
  }
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol")?.toUpperCase();
    const timeframe = searchParams.get("timeframe") || "1h";
    const limit = parseInt(searchParams.get("limit")) || 100;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    const interval = getBinanceInterval(timeframe);
    
    // Fetch klines (candlestick) data from Binance
    const response = await fetch(
      `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const klines = await response.json();

    // Transform Binance klines data to our format
    const candlestickData = klines.map((kline) => ({
      time: Math.floor(kline[0] / 1000), // Convert to seconds
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));

    return NextResponse.json({
      success: true,
      symbol,
      timeframe,
      interval,
      data: candlestickData,
      count: candlestickData.length,
    });
  } catch (error) {
    console.error("Error fetching klines data:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to fetch candlestick data" 
      },
      { status: 500 }
    );
  }
}
