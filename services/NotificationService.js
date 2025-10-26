import { AlertsCache } from "../utils/redis.js";
import dotenv from "dotenv";
dotenv.config();
class NotificationService {
  constructor() {
    this.subscribers = new Map(); // userId -> Set of callbacks
  }

  // Subscribe to notifications for a user
  subscribe(userId, callback) {
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, new Set());
    }
    this.subscribers.get(userId).add(callback);
  }

  // Unsubscribe from notifications
  unsubscribe(userId, callback) {
    if (this.subscribers.has(userId)) {
      this.subscribers.get(userId).delete(callback);
      if (this.subscribers.get(userId).size === 0) {
        this.subscribers.delete(userId);
      }
    }
  }

  // Send notification to user
  async sendNotification(userId, notification) {
    try {
      // Store notification in Redis for persistence
      await this.storeNotification(userId, notification);

      // Send to real-time subscribers
      if (this.subscribers.has(userId)) {
        this.subscribers.get(userId).forEach((callback) => {
          try {
            callback(notification);
          } catch (error) {
            console.error("❌ Error sending notification to user:", error);
          }
        });
      }

      console.log(
        `📢 Notification sent to user ${userId}: ${notification.symbol} alert triggered`
      );
    } catch (error) {
      console.error("❌ Error sending notification:", error);
    }
  }

  // Store notification in Redis
  async storeNotification(userId, notification) {
    try {
      const key = `notifications:${userId}`;
      const notifications = (await AlertsCache.getUserAlerts(userId)) || [];

      // Add new notification
      notifications.unshift({
        ...notification,
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        read: false,
      });

      // Keep only last 100 notifications
      if (notifications.length > 100) {
        notifications.splice(100);
      }

      // Store in Redis
      await AlertsCache.setUserAlerts(userId, notifications);
    } catch (error) {
      console.error("❌ Error storing notification:", error);
    }
  }

  // Get notifications for user
  async getNotifications(userId) {
    try {
      const key = `notifications:${userId}`;
      return (await AlertsCache.getUserAlerts(userId)) || [];
    } catch (error) {
      console.error("❌ Error getting notifications:", error);
      return [];
    }
  }

  // Mark notification as read
  async markAsRead(userId, notificationId) {
    try {
      const notifications = await this.getNotifications(userId);
      const notification = notifications.find((n) => n.id === notificationId);
      if (notification) {
        notification.read = true;
        await AlertsCache.setUserAlerts(userId, notifications);
      }
    } catch (error) {
      console.error("❌ Error marking notification as read:", error);
    }
  }

  // Clear all notifications for user
  async clearNotifications(userId) {
    try {
      await AlertsCache.setUserAlerts(userId, []);
    } catch (error) {
      console.error("❌ Error clearing notifications:", error);
    }
  }
}

export default new NotificationService();
