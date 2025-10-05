import { NextResponse } from 'next/server';
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  lazyConnect: true,
  retryDelayOnClusterDown: 300,
  maxRetriesPerRequest: 3,
});

let isConnected = false;
let subscriber = null;
let activeConnections = new Set();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') || 'default';

  // Create a ReadableStream for Server-Sent Events
  const stream = new ReadableStream({
    start(controller) {
      const connectionId = Date.now();
      activeConnections.add(connectionId);

      console.log(`🔌 Alert SSE connection ${connectionId} started for user ${userId}`);

      // Initialize Redis subscriber if not already done
      if (!subscriber) {
        subscriber = new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          lazyConnect: true,
        });

        subscriber.subscribe('alert:triggers', (err, count) => {
          if (err) {
            console.error('❌ Redis subscription error:', err);
            return;
          }
          console.log(`✅ Subscribed to alert:triggers (${count} channels)`);
        });

        subscriber.on('message', (channel, message) => {
          if (channel === 'alert:triggers') {
            try {
              const alertData = JSON.parse(message);
              
              // Broadcast to all active connections
              activeConnections.forEach(id => {
                const encoder = new TextEncoder();
                const data = `data: ${JSON.stringify(alertData)}\n\n`;
                controller.enqueue(encoder.encode(data));
              });
              
              console.log(`📡 Broadcasting alert to ${activeConnections.size} connections`);
            } catch (error) {
              console.error('❌ Error processing alert message:', error);
            }
          }
        });

        subscriber.on('error', (err) => {
          console.error('❌ Redis subscriber error:', err);
        });
      }

      // Send initial connection message
      const encoder = new TextEncoder();
      const initMessage = `data: ${JSON.stringify({
        type: 'connected',
        userId,
        timestamp: new Date().toISOString()
      })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeatMessage = `data: ${JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString()
          })}\n\n`;
          controller.enqueue(encoder.encode(heartbeatMessage));
        } catch (error) {
          console.error('❌ Error sending heartbeat:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000); // Every 30 seconds

      // Cleanup on connection close
      const cleanup = () => {
        activeConnections.delete(connectionId);
        clearInterval(heartbeatInterval);
        console.log(`🔌 Alert SSE connection ${connectionId} closed`);
      };

      // Handle connection close
      request.signal?.addEventListener('abort', cleanup);
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}
