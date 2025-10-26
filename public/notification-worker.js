// Simple service worker to prevent 404 errors
// This file exists to prevent browser requests for notification-worker.js from failing

console.log("📱 Notification Worker loaded");

// Basic service worker functionality
self.addEventListener("install", (event) => {
  console.log("📱 Notification Worker installed");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("📱 Notification Worker activated");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Let all requests pass through
  return;
});

// Handle push notifications if needed
self.addEventListener("push", (event) => {
  console.log("📱 Push notification received");

  const options = {
    body: "New alert notification",
    icon: "/icon-192x192.png",
    badge: "/badge-72x72.png",
    tag: "alert-notification",
  };

  event.waitUntil(self.registration.showNotification("Crypto Alert", options));
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  console.log("📱 Notification clicked");
  event.notification.close();

  // Open the app
  event.waitUntil(self.clients.openWindow("/"));
});
