import { NextResponse } from "next/server";
import Redis from "ioredis";

// Redis configuration - shared connection pool
const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryDelayOnClusterDown: 300,
  maxRetriesPerRequest: 3,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
});

// Handle Redis connection errors
redis.on("error", (err) => {
  console.error("❌ Redis stream API error:", err);
});

// Track active connections to prevent memory leaks
const activeConnections = new Set();

// Shared Redis subscriber to avoid creating too many connections
let sharedSubscriber = null;
const subscriberClients = new Map(); // Map of connectionId -> controller

// Initialize shared subscriber
const initializeSharedSubscriber = () => {
  if (sharedSubscriber) return;

  sharedSubscriber = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryDelayOnClusterDown: 300,
    maxRetriesPerRequest: 3,
    keepAlive: 30000,
    connectTimeout: 10000,
    commandTimeout: 5000,
  });

  sharedSubscriber.on("error", (err) => {
    console.error("❌ Shared Redis subscriber error:", err);
  });

  sharedSubscriber.on("connect", () => {
    console.log("✅ Shared Redis subscriber connected");
  });

  sharedSubscriber.on("close", () => {
    console.log("🔌 Shared Redis subscriber disconnected");
  });

  // Subscribe to general channels
  sharedSubscriber.subscribe(["market:updates", "market:heartbeat"], (err) => {
    if (err) {
      console.error("❌ Shared Redis subscription error:", err);
    } else {
      console.log("✅ Shared Redis subscriber subscribed to general channels");
    }
  });

  // Handle messages from shared subscriber
  sharedSubscriber.on("message", (channel, message) => {
    try {
      const data = JSON.parse(message);
      console.log(
        `📡 Broadcasting to ${subscriberClients.size} clients:`,
        data.type,
        data.symbol || "N/A"
      );

      // Broadcast to all connected clients
      subscriberClients.forEach((controller, connectionId) => {
        try {
          if (data.type === "heartbeat") {
            controller.enqueue(
              `data: ${JSON.stringify({
                type: "heartbeat",
                timestamp: data.timestamp,
              })}\n\n`
            );
          } else if (
            data.type === "market_update" ||
            data.type === "ticker_update" ||
            data.type === "symbol_update"
          ) {
            controller.enqueue(
              `data: ${JSON.stringify({
                type: "market_update",
                symbol: data.symbol || data.data.symbol,
                data: data.data,
              })}\n\n`
            );
          }
        } catch (error) {
          console.log(`📡 Controller closed for connection ${connectionId}`);
          subscriberClients.delete(connectionId);
          activeConnections.delete(connectionId);
        }
      });
    } catch (error) {
      console.error("❌ Error processing shared Redis message:", error);
    }
  });
};

// Periodic cleanup of stale connections (every 5 minutes)
setInterval(() => {
  console.log(`📊 Active SSE connections: ${activeConnections.size}`);
  console.log(`📊 Subscriber clients: ${subscriberClients.size}`);
}, 300000);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get("symbols")?.split(",") || [];

  // Set up Server-Sent Events headers
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  const stream = new ReadableStream({
    async start(controller) {
      console.log("📡 SSE connection started for symbols:", symbols);

      // Track connection state
      let isConnected = true;
      let heartbeatInterval = null;
      const connectionId = Date.now() + Math.random();
      activeConnections.add(connectionId);

      // DON'T add to subscriberClients yet - wait for initial data to be sent first!
      // This prevents market_update messages from causing counting effect

      // Initialize shared subscriber if not already done
      initializeSharedSubscriber();

      // Helper function to safely enqueue data
      const safeEnqueue = (data) => {
        if (isConnected) {
          try {
            controller.enqueue(data);
          } catch (error) {
            console.log("📡 Controller closed, stopping data stream");
            isConnected = false;
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
            }
            activeConnections.delete(connectionId);
            subscriberClients.delete(connectionId);
          }
        }
      };

      // CRITICAL FIX: Send initial data FIRST, then add to subscriber list
      // This prevents counting effect by ensuring all 437 pairs load before any market_update
      await sendInitialData(controller, symbols);

      // Brief pause to ensure frontend processes initial_data
      await new Promise(resolve => setTimeout(resolve, 100));

      // NOW add to subscriber clients - only after initial data is sent
      subscriberClients.set(connectionId, controller);
      console.log(`📡 Client ${connectionId} ready for real-time updates`);

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        console.log("📡 SSE connection closed");
        isConnected = false;
        activeConnections.delete(connectionId);
        subscriberClients.delete(connectionId);

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }

        try {
          controller.close();
        } catch (error) {
          // Controller might already be closed
        }
      });

      // Keep connection alive
      heartbeatInterval = setInterval(() => {
        if (isConnected) {
          safeEnqueue(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
        }
      }, 30000);
    },
  });

  return new Response(stream, { headers });
}

// Add cleanup function to prevent memory leaks
export async function POST() {
  return NextResponse.json({
    activeConnections: activeConnections.size,
    message: "Connection status retrieved",
  });
}

async function sendInitialData(controller, symbols) {
  try {
    let validData = [];
    const startTime = Date.now();

    if (symbols.length === 0) {
      // STRATEGY: Binance API FIRST - guaranteed 437 active TRADING pairs
      console.log("📊 [GUARANTEED LOAD] Fetching active trading pairs from Binance API...");

      try {
        // Step 1: Get exchangeInfo to find ONLY active TRADING pairs
        const exchangeResponse = await fetch("https://api.binance.com/api/v3/exchangeInfo", {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        });

        let validTradingPairs = new Set();

        if (exchangeResponse.ok) {
          const exchangeInfo = await exchangeResponse.json();

          // Filter for ONLY active TRADING USDT spot pairs (same as binance-worker)
          validTradingPairs = new Set(
            exchangeInfo.symbols
              .filter((symbol) => {
                return (
                  symbol.status === "TRADING" &&
                  symbol.symbol.endsWith("USDT") &&
                  symbol.isSpotTradingAllowed === true &&
                  !symbol.symbol.includes("_") &&
                  !symbol.symbol.includes("BULL") &&
                  !symbol.symbol.includes("BEAR") &&
                  !symbol.symbol.includes("3L") &&
                  !symbol.symbol.includes("3S") &&
                  !symbol.symbol.includes("5L") &&
                  !symbol.symbol.includes("5S") &&
                  symbol.baseAsset !== "BUSD" &&
                  symbol.quoteAsset === "USDT"
                );
              })
              .map((symbol) => symbol.symbol)
          );

          console.log(`📊 Found ${validTradingPairs.size} active TRADING pairs from exchangeInfo`);
        }

        // Step 2: Get ticker data for all pairs
        const tickerResponse = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        });

        if (tickerResponse.ok) {
          const allTickers = await tickerResponse.json();

          // Filter tickers to ONLY include active TRADING pairs
          const activeTickers = allTickers.filter(t => validTradingPairs.has(t.symbol));

          validData = activeTickers.map(t => ({
            symbol: t.symbol,
            price: parseFloat(t.lastPrice),
            priceChange: parseFloat(t.priceChange),
            priceChangePercent: parseFloat(t.priceChangePercent),
            change: parseFloat(t.priceChangePercent),
            changeAmount: parseFloat(t.priceChange),
            volume24h: parseFloat(t.quoteVolume),
            high: parseFloat(t.highPrice),
            low: parseFloat(t.lowPrice),
            high24h: parseFloat(t.highPrice),
            low24h: parseFloat(t.lowPrice),
            open: parseFloat(t.openPrice),
            close: parseFloat(t.lastPrice),
            openPrice: parseFloat(t.openPrice),
            closePrice: parseFloat(t.lastPrice),
            timestamp: Date.now(),
            isFavorite: false,
          }));

          console.log(`✅ BINANCE API: ${validData.length} active TRADING pairs in ${Date.now() - startTime}ms`);
        }
      } catch (binanceError) {
        console.error("⚠️ Binance API error, trying Redis:", binanceError.message);
      }

      // Fallback to Redis ONLY if Binance failed
      if (validData.length < 400) {
        console.log(`📊 Redis fallback (Binance: ${validData.length} pairs)...`);
        const allKeys = await redis.keys("crypto:*");
        const cryptoKeys = allKeys.filter(
          (key) => key !== "crypto:usdt_pairs" && !key.includes("undefined")
        );

        if (cryptoKeys.length > 0) {
          const pipeline = redis.pipeline();
          cryptoKeys.forEach((key) => pipeline.get(key));
          const results = await pipeline.exec();
          validData = results
            .map(([err, data]) => {
              if (err || !data) return null;
              try { return JSON.parse(data); } catch (e) { return null; }
            })
            .filter(Boolean);
          console.log(`✅ Redis fallback: ${validData.length} pairs`);
        }
      }
    } else {
      // Specific symbols requested - use pipeline
      const pipeline = redis.pipeline();
      symbols.forEach((symbol) => {
        pipeline.get(`crypto:${symbol.toUpperCase()}`);
      });

      const results = await pipeline.exec();
      validData = results
        .map(([err, data]) => {
          if (err || !data) return null;
          try {
            return JSON.parse(data);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    }

    // SEND ALL DATA AT ONCE - no streaming, no counting effect
    if (validData.length > 0) {
      try {
        const payload = JSON.stringify({
          type: "initial_data",
          data: validData,
          count: validData.length,
          loadTime: Date.now() - startTime,
        });

        controller.enqueue(`data: ${payload}\n\n`);
        console.log(`📡 ✅ Sent ALL ${validData.length} pairs INSTANTLY in ${Date.now() - startTime}ms`);
      } catch (error) {
        console.log("📡 Controller closed during initial data send");
      }
    } else {
      console.log("⚠️ No market data available for initial load");
      // Send empty initial data so frontend knows loading is complete
      controller.enqueue(`data: ${JSON.stringify({
        type: "initial_data",
        data: [],
        count: 0,
        message: "Waiting for market data..."
      })}\n\n`);
    }
  } catch (error) {
    console.error("❌ Error sending initial data:", error);
  }
}
