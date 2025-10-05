import AlertHistory from "../models/AlertHistory.js";

class AlertHistoryService {
  // Create alert history entry when alert is triggered
  static async createAlertHistory(alert, triggerData) {
    try {
      const alertHistory = new AlertHistory({
        alertId: alert._id,
        userId: alert.userId,
        symbol: alert.symbol,
        alertConditions: alert.conditions,
        triggerData: {
          price: parseFloat(triggerData.price),
          volume: parseFloat(triggerData.volume),
          priceChangePercent: parseFloat(triggerData.priceChangePercent),
          timestamp: new Date(),
        },
        notificationSent: {
          email: alert.notificationSettings?.email || false,
          telegram: alert.notificationSettings?.telegram || false,
          webhook: alert.notificationSettings?.webhook || false,
        },
        status: "triggered",
      });

      await alertHistory.save();
      console.log(`📝 Alert history created for ${alert.symbol}`);
      return alertHistory;
    } catch (error) {
      console.error("❌ Error creating alert history:", error);
      throw error;
    }
  }

  // Get alert history for a user
  static async getUserAlertHistory(userId, limit = 50, offset = 0) {
    try {
      const alertHistory = await AlertHistory.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .populate("alertId", "symbol conditions status");

      return alertHistory;
    } catch (error) {
      console.error("❌ Error fetching alert history:", error);
      throw error;
    }
  }

  // Get alert history for a specific symbol
  static async getSymbolAlertHistory(symbol, limit = 50, offset = 0) {
    try {
      const alertHistory = await AlertHistory.find({ symbol })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .populate("alertId", "symbol conditions status");

      return alertHistory;
    } catch (error) {
      console.error("❌ Error fetching symbol alert history:", error);
      throw error;
    }
  }

  // Get alert history by alert ID
  static async getAlertHistoryByAlertId(alertId) {
    try {
      const alertHistory = await AlertHistory.find({ alertId })
        .sort({ createdAt: -1 })
        .populate("alertId", "symbol conditions status");

      return alertHistory;
    } catch (error) {
      console.error("❌ Error fetching alert history by alert ID:", error);
      throw error;
    }
  }

  // Update alert history status
  static async updateAlertHistoryStatus(historyId, status, userId) {
    try {
      const updateData = { status };

      if (status === "acknowledged") {
        updateData.acknowledgedAt = new Date();
      } else if (status === "dismissed") {
        updateData.dismissedAt = new Date();
      }

      const alertHistory = await AlertHistory.findOneAndUpdate(
        { _id: historyId, userId },
        updateData,
        { new: true }
      );

      return alertHistory;
    } catch (error) {
      console.error("❌ Error updating alert history status:", error);
      throw error;
    }
  }

  // Get alert history statistics
  static async getAlertHistoryStats(userId) {
    try {
      const stats = await AlertHistory.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const totalAlerts = await AlertHistory.countDocuments({ userId });
      const recentAlerts = await AlertHistory.countDocuments({
        userId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
      });

      return {
        totalAlerts,
        recentAlerts,
        statusBreakdown: stats,
      };
    } catch (error) {
      console.error("❌ Error fetching alert history stats:", error);
      throw error;
    }
  }

  // Get recent alert history (last 24 hours)
  static async getRecentAlertHistory(userId, hours = 24) {
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const alertHistory = await AlertHistory.find({
        userId,
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .populate("alertId", "symbol conditions status");

      return alertHistory;
    } catch (error) {
      console.error("❌ Error fetching recent alert history:", error);
      throw error;
    }
  }

  // Delete alert history (cleanup old records)
  static async deleteOldAlertHistory(daysOld = 30) {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

      const result = await AlertHistory.deleteMany({
        createdAt: { $lt: cutoffDate },
      });

      console.log(
        `🗑️ Deleted ${result.deletedCount} old alert history records`
      );
      return result;
    } catch (error) {
      console.error("❌ Error deleting old alert history:", error);
      throw error;
    }
  }

  // Get alert history with pagination
  static async getAlertHistoryWithPagination(userId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;

      const [alertHistory, totalCount] = await Promise.all([
        AlertHistory.find({ userId })
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .populate("alertId", "symbol conditions status"),
        AlertHistory.countDocuments({ userId }),
      ]);

      return {
        data: alertHistory,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      console.error("❌ Error fetching paginated alert history:", error);
      throw error;
    }
  }
}

export default AlertHistoryService;
