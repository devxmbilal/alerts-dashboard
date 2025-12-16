import AlertHistory from "../models/AlertHistory.js";
import Alert from "../models/Alert.js";
import dotenv from "dotenv";
dotenv.config();
class AlertHistoryService {
  // Create alert history entry when alert is triggered
  static async createAlertHistory(alertHistoryData) {
    try {
      console.log(
        `📝 Creating alert history for ${alertHistoryData.symbol}...`
      );


      const alertHistory = new AlertHistory({
        alertId: alertHistoryData.alertId,
        userId: alertHistoryData.userId,
        symbol: alertHistoryData.symbol,
        alertConditions: alertHistoryData.alertConditions,
        conditions: alertHistoryData.conditions,
        triggerData: {
          price: parseFloat(alertHistoryData.triggerData.price),
          priceChange: parseFloat(alertHistoryData.triggerData.priceChange),
          priceChangePercent: parseFloat(
            alertHistoryData.triggerData.priceChangePercent
          ),
          volume24h: parseFloat(
            alertHistoryData.triggerData.volume24h ||
            alertHistoryData.triggerData.volume ||
            0
          ),
          high: parseFloat(alertHistoryData.triggerData.high),
          low: parseFloat(alertHistoryData.triggerData.low),
          open: parseFloat(alertHistoryData.triggerData.open),
          close: parseFloat(alertHistoryData.triggerData.close),
          timestamp: alertHistoryData.triggerData.timestamp,
        },
        baselineData: {
          baselinePrice: parseFloat(
            alertHistoryData.baselineData.baselinePrice
          ),
          baselineVolume: parseFloat(
            alertHistoryData.baselineData.baselineVolume || 0
          ),
          baselineTimestamp: alertHistoryData.baselineData.baselineTimestamp,
          changeFromBaseline: parseFloat(
            alertHistoryData.baselineData.changeFromBaseline
          ),
          changeFromBaselinePercent: parseFloat(
            alertHistoryData.baselineData.changeFromBaselinePercent
          ),
        },
        triggeredAt: alertHistoryData.triggeredAt,
        status: "triggered",
      });

      console.log(`📝 Saving alert history to database...`);
      await alertHistory.save();
      console.log(
        `✅ Alert history created for ${alertHistoryData.symbol} with ID: ${alertHistory._id}`
      );
      return alertHistory;
    } catch (error) {
      console.error("❌ Error creating alert history:", error);
      console.error("❌ Error details:", error.message);
      console.error("❌ Error stack:", error.stack);
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

  // Get the latest triggered alert for a user (for chart switching)
  static async getLatestTriggeredAlert(userId) {
    try {
      console.log(`🔍 Getting latest triggered alert for user: ${userId}`);

      const latestAlert = await AlertHistory.findOne({ userId })
        .sort({ triggeredAt: -1 })
        .populate("alertId", "symbol conditions status")
        .lean();

      if (!latestAlert) {
        console.log(`📭 No triggered alerts found for user: ${userId}`);
        return null;
      }

      console.log(`✅ Latest triggered alert found:`, {
        id: latestAlert._id,
        symbol: latestAlert.symbol,
        triggeredAt: latestAlert.triggeredAt,
        price: latestAlert.triggerData?.price,
      });

      return latestAlert;
    } catch (error) {
      console.error("❌ Error fetching latest triggered alert:", error);
      throw error;
    }
  }

  // Clean up old alert history entries (older than 24 hours)
  static async cleanupOldAlerts() {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      console.log(
        `🧹 Cleaning up alert history older than: ${twentyFourHoursAgo.toISOString()}`
      );

      const result = await AlertHistory.deleteMany({
        triggeredAt: { $lt: twentyFourHoursAgo },
      });

      console.log(
        `✅ Cleaned up ${result.deletedCount} old alert history entries`
      );
      return result.deletedCount;
    } catch (error) {
      console.error("❌ Error cleaning up old alerts:", error);
      throw error;
    }
  }

  // Clear all alert history for a user
  static async clearUserAlertHistory(userId) {
    try {
      console.log(`🗑️ Clearing all alert history for user ${userId}...`);

      const result = await AlertHistory.deleteMany({
        userId: userId,
      });

      console.log(
        `✅ Cleared ${result.deletedCount} alert history records for user ${userId}`
      );

      return {
        success: true,
        deletedCount: result.deletedCount,
      };
    } catch (error) {
      console.error("❌ Error clearing alert history:", error);
      throw error;
    }
  }
}

export default AlertHistoryService;
