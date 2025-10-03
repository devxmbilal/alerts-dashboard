import { NextResponse } from "next/server";
import Redis from "ioredis";

// Redis configuration
const redis = new Redis({
  host: "localhost",
  port: 6379,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryDelayOnClusterDown: 300,
  maxRetriesPerRequest: 3,
});

// Handle Redis connection errors
redis.on("error", (err) => {
  console.error("❌ Redis stream API error:", err);
});

// Track active connections to prevent memory leaks
const activeConnections = new Set();

// Periodic cleanup of stale connections (every 5 minutes)
setInterval(() => {
  console.log(`📊 Active SSE connections: ${activeConnections.size}`);
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
    start(controller) {
      console.log("📡 SSE connection started for symbols:", symbols);

      // Track connection state
      let isConnected = true;
      let heartbeatInterval = null;
      const connectionId = Date.now() + Math.random();
      activeConnections.add(connectionId);

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
          }
        }
      };

      // Send initial data
      sendInitialData(controller, symbols);

      // Subscribe to Redis channels
      const channels = ["market:updates", "market:heartbeat"];
      symbols.forEach((symbol) => {
        channels.push(`market:${symbol.toLowerCase()}`);
      });

      // Subscribe to Redis pub/sub
      const subscriber = new Redis({
        host: "localhost",
        port: 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: 3,
      });

      // Handle Redis connection errors
      subscriber.on("error", (err) => {
        console.error("❌ Redis subscriber error:", err);
      });

      subscriber.on("connect", () => {
        console.log("✅ Redis subscriber connected");
      });

      subscriber.on("close", () => {
        console.log("🔌 Redis subscriber disconnected");
      });

      subscriber.subscribe(channels, (err) => {
        if (err) {
          console.error("❌ Redis subscription error:", err);
          return;
        }
        console.log("✅ Subscribed to Redis channels:", channels);
      });

      subscriber.on("message", (channel, message) => {
        if (!isConnected) return; // Don't process messages if connection is closed

        try {
          const data = JSON.parse(message);

          if (data.type === "heartbeat") {
            // Send heartbeat to keep connection alive
            safeEnqueue(
              `data: ${JSON.stringify({
                type: "heartbeat",
                timestamp: data.timestamp,
              })}\n\n`
            );
            return;
          }

          if (data.type === "ticker_update" || data.type === "symbol_update") {
            // Send market data update
            safeEnqueue(
              `data: ${JSON.stringify({
                type: "market_update",
                symbol: data.data.symbol,
                data: data.data,
              })}\n\n`
            );
          }
        } catch (error) {
          console.error("❌ Error processing Redis message:", error);
        }
      });

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        console.log("📡 SSE connection closed");
        isConnected = false;
        activeConnections.delete(connectionId);

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }

        try {
          subscriber.unsubscribe();
          subscriber.disconnect();
        } catch (error) {
          console.error("❌ Error disconnecting Redis:", error);
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
    // Get cached data from Redis
    const promises = symbols.map(async (symbol) => {
      const cacheKey = `crypto:${symbol.toLowerCase()}`;
      const cached = await redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    });

    const cachedData = await Promise.all(promises);
    const validData = cachedData.filter(Boolean);

    if (validData.length > 0) {
      try {
        controller.enqueue(
          `data: ${JSON.stringify({
            type: "initial_data",
            data: validData,
          })}\n\n`
        );
      } catch (error) {
        console.log("📡 Controller closed during initial data send");
      }
    }
  } catch (error) {
    console.error("❌ Error sending initial data:", error);
  }
}
