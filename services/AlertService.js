import Alert from "../models/Alert.js";

class AlertService {
  // Create a new alert
  static async createAlert(
    userId,
    symbol,
    conditions,
    notificationSettings = {}
  ) {
    try {
      const alert = new Alert({
        userId,
        symbol,
        conditions,
        notificationSettings,
      });

      await alert.save();
      console.log(`✅ Alert created for ${symbol} by user ${userId}`);
      return alert;
    } catch (error) {
      console.error("❌ Error creating alert:", error);
      throw error;
    }
  }

  // Get all active alerts for a symbol
  static async getActiveAlertsForSymbol(symbol) {
    try {
      const alerts = await Alert.find({
        symbol,
        status: "active",
        triggered: false,
      });
      return alerts;
    } catch (error) {
      console.error("❌ Error fetching alerts for symbol:", error);
      throw error;
    }
  }

  // Get all active alerts for a user
  static async getUserAlerts(userId) {
    try {
      const alerts = await Alert.find({
        userId,
        status: { $in: ["active", "paused"] },
      }).sort({ createdAt: -1 });
      return alerts;
    } catch (error) {
      console.error("❌ Error fetching user alerts:", error);
      throw error;
    }
  }

  // Update alert status
  static async updateAlertStatus(alertId, status) {
    try {
      const alert = await Alert.findByIdAndUpdate(
        alertId,
        { status, updatedAt: new Date() },
        { new: true }
      );
      return alert;
    } catch (error) {
      console.error("❌ Error updating alert status:", error);
      throw error;
    }
  }

  // Mark alert as triggered
  static async triggerAlert(alertId, marketData) {
    try {
      const alert = await Alert.findByIdAndUpdate(
        alertId,
        {
          triggered: true,
          triggeredAt: new Date(),
          triggeredPrice: parseFloat(marketData.price),
          triggeredVolume: parseFloat(marketData.volume),
          triggeredChange: parseFloat(marketData.priceChangePercent),
          status: "triggered",
          updatedAt: new Date(),
        },
        { new: true }
      );

      console.log(
        `🚨 Alert triggered for ${alert.symbol} at ${alert.triggeredPrice}`
      );
      return alert;
    } catch (error) {
      console.error("❌ Error triggering alert:", error);
      throw error;
    }
  }

  // Delete alert
  static async deleteAlert(alertId, userId) {
    try {
      const alert = await Alert.findOneAndDelete({
        _id: alertId,
        userId,
      });
      return alert;
    } catch (error) {
      console.error("❌ Error deleting alert:", error);
      throw error;
    }
  }

  // Get triggered alerts for a user
  static async getTriggeredAlerts(userId, limit = 50) {
    try {
      const alerts = await Alert.find({
        userId,
        triggered: true,
      })
        .sort({ triggeredAt: -1 })
        .limit(limit);
      return alerts;
    } catch (error) {
      console.error("❌ Error fetching triggered alerts:", error);
      throw error;
    }
  }

  // Get alert statistics
  static async getAlertStats(userId) {
    try {
      const stats = await Alert.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);
      return stats;
    } catch (error) {
      console.error("❌ Error fetching alert stats:", error);
      throw error;
    }
  }
}

export default AlertService;
