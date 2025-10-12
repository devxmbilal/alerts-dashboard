import { NextResponse } from "next/server";
import { verifyToken } from "../../../../utils/auth.js";
import NotificationService from "../../../../services/NotificationService.js";

// GET /api/notifications/stream - Server-Sent Events for real-time notifications
export async function GET(request) {
  try {
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

    const userId = decoded.userId;

    // Create a readable stream for Server-Sent Events
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection message
        const data = `data: ${JSON.stringify({
          type: "connected",
          message: "Connected to notifications",
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));

        // Subscribe to notifications for this user
        const notificationCallback = (notification) => {
          try {
            const data = `data: ${JSON.stringify(notification)}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));
          } catch (error) {
            console.error("❌ Error sending notification via SSE:", error);
          }
        };

        NotificationService.subscribe(userId, notificationCallback);

        // Send existing notifications
        NotificationService.getNotifications(userId).then((notifications) => {
          notifications.forEach((notification) => {
            const data = `data: ${JSON.stringify(notification)}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));
          });
        });

        // Handle client disconnect
        request.signal.addEventListener("abort", () => {
          NotificationService.unsubscribe(userId, notificationCallback);
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
