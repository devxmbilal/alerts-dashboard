import { NextResponse } from "next/server";
import { verifyToken } from "../../../../utils/auth.js";
import NotificationService from "../../../../services/NotificationService.js";

// GET /api/notifications/stream - Server-Sent Events for real-time notifications
export async function GET(request) {
  try {
    // Get token from query parameter (EventSource doesn't support custom headers)
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Authorization token required" },
        { status: 401 }
      );
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const userId = decoded.userId;

    console.log("\n🔍 ===== SSE STREAM SETUP =====");
    console.log("🔍 UserId:", userId);
    console.log("🔍 Token valid: true");

    // Create a readable stream for Server-Sent Events
    const stream = new ReadableStream({
      start(controller) {
        console.log("✅ SSE stream started for user:", userId);

        // Send initial connection message
        const data = `data: ${JSON.stringify({
          type: "connected",
          message: "Connected to notifications",
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
        console.log("✅ Initial connection message sent");

        // Subscribe to notifications for this user (optional)
        let notificationCallback = null;
        try {
          notificationCallback = (notification) => {
            try {
              console.log(
                "📤 SSE: Sending notification to client:",
                notification.symbol
              );
              const data = `data: ${JSON.stringify(notification)}\n\n`;
              controller.enqueue(new TextEncoder().encode(data));
              console.log("✅ SSE: Notification sent successfully");
            } catch (error) {
              console.error("❌ SSE: Error sending notification:", error);
            }
          };

          NotificationService.subscribe(userId, notificationCallback);
          console.log("✅ Subscribed to NotificationService for user:", userId);
          console.log(
            "🔍 Total subscribers now:",
            NotificationService.subscribers.size
          );
          console.log(
            "🔍 Subscribers for this user:",
            NotificationService.subscribers.get(userId)?.size || 0
          );

          // Send existing notifications
          NotificationService.getNotifications(userId)
            .then((notifications) => {
              notifications.forEach((notification) => {
                const data = `data: ${JSON.stringify(notification)}\n\n`;
                controller.enqueue(new TextEncoder().encode(data));
              });
            })
            .catch((error) => {
              console.warn("⚠️ Error getting existing notifications:", error);
            });
        } catch (serviceError) {
          console.warn(
            "⚠️ NotificationService not available:",
            serviceError.message
          );
        }

        // Handle client disconnect
        request.signal.addEventListener("abort", () => {
          if (notificationCallback) {
            try {
              NotificationService.unsubscribe(userId, notificationCallback);
            } catch (error) {
              console.warn("⚠️ Error unsubscribing from notifications:", error);
            }
          }
          controller.close();
        });
      },
      cancel() {
        // Clean up when client disconnects
        console.log(
          `🔌 Client disconnected from notifications stream for user ${userId}`
        );
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
  } catch (error) {
    console.error("❌ Error in notifications stream:", error);
    // Return a proper SSE error response instead of JSON
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        message: "Connection failed",
        error: error.message,
      })}\n\n`,
      {
        status: 500,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      }
    );
  }
}
