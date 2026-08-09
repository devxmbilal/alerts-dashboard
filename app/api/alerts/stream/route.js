import { NextResponse } from "next/server";
import Redis from "ioredis";

// Redis configuration
const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  // Create SSE response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      console.log(`🔌 Alert stream started for user: ${userId}`);

      // Subscribe to alert triggers for this user
      const subscriber = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
      });

      // Subscribe to both alert channels for maximum compatibility
      subscriber.subscribe(["alert:triggers", "alerts:stream"], (err) => {
        if (err) {
          console.error("❌ Redis subscription error:", err);
          return;
        }
        console.log("✅ Subscribed to alert channels (alert:triggers, alerts:stream)");
      });

      subscriber.on("message", (channel, message) => {
        try {
          const alertData = JSON.parse(message);

          // Extract raw userId safely whether it's a string, ObjectId, or nested object
          const rawAlertUserId = alertData.userId;
          let alertUserIdStr = "";
          if (rawAlertUserId) {
            if (typeof rawAlertUserId === "object") {
              alertUserIdStr = String(rawAlertUserId._id || rawAlertUserId.id || rawAlertUserId);
            } else {
              alertUserIdStr = String(rawAlertUserId);
            }
          }
          const requestUserIdStr = String(userId || "");

          // Send alert if: user IDs match, OR alertUserId is missing/invalid (broadcast)
          const isUserMatch =
            !alertUserIdStr ||
            alertUserIdStr === "[object Object]" ||
            alertUserIdStr === requestUserIdStr;

          if (isUserMatch) {
            console.log("🚨 Alert triggered for user stream:", userId, alertData.symbol);

            const data = JSON.stringify({
              type: "alert_triggered",
              data: alertData,
            });

            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } else {
            console.log(
              `⚠️ Alert for different user (alert: ${alertUserIdStr}, request: ${requestUserIdStr})`
            );
          }
        } catch (error) {
          console.error("❌ Error parsing alert message:", error);
        }
      });

      // Send heartbeat every 30 seconds
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`)
          );
        } catch (error) {
          console.error("❌ Heartbeat error:", error);
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        console.log("🔌 Alert stream closed for user:", userId);
        clearInterval(heartbeat);
        subscriber.disconnect();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}
