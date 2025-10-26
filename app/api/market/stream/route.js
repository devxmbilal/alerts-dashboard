import { NextResponse } from "next/server";
import Redis from "ioredis";

// Redis configuration - shared connection pool
const redis = new Redis({
  host: "localhost",
  port: 6379,
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
    host: "localhost",
    port: 6379,
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
    start(controller) {
      console.log("📡 SSE connection started for symbols:", symbols);

      // Track connection state
      let isConnected = true;
      let heartbeatInterval = null;
      const connectionId = Date.now() + Math.random();
      activeConnections.add(connectionId);
      subscriberClients.set(connectionId, controller);

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

      // Send initial data
      sendInitialData(controller, symbols);

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

    if (symbols.length === 0) {
      // If no specific symbols requested, get all available data
      console.log("📊 Fetching all market data for initial load...");
      const allKeys = await redis.keys("crypto:*");
      const cryptoKeys = allKeys.filter(
        (key) => key !== "crypto:usdt_pairs" && !key.includes("undefined")
      );

      const promises = cryptoKeys.map(async (key) => {
        const cached = await redis.get(key);
        return cached ? JSON.parse(cached) : null;
      });

      const cachedData = await Promise.all(promises);
      validData = cachedData.filter(Boolean);
      console.log(`📊 Found ${validData.length} market data entries`);
    } else {
      // Get specific symbols data
      const promises = symbols.map(async (symbol) => {
        const cacheKey = `crypto:${symbol.toLowerCase()}`;
        const cached = await redis.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
      });

      const cachedData = await Promise.all(promises);
      validData = cachedData.filter(Boolean);
    }

    if (validData.length > 0) {
      try {
        controller.enqueue(
          `data: ${JSON.stringify({
            type: "initial_data",
            data: validData,
          })}\n\n`
        );
        console.log(`📡 Sent initial data: ${validData.length} symbols`);
      } catch (error) {
        console.log("📡 Controller closed during initial data send");
      }
    } else {
      console.log("⚠️ No market data available for initial load");
    }
  } catch (error) {
    console.error("❌ Error sending initial data:", error);
  }
}
