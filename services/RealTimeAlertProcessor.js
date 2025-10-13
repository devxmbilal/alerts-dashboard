import { AlertsCache, FavoritesCache } from "../utils/redis.js";
import { isAlertLocked, updateAlertLock } from "../utils/alertLock.js";
import AlertHistoryService from "./AlertHistoryService.js";
import NotificationService from "./NotificationService.js";
import Alert from "../models/Alert.js";
import User from "../models/User.js";

class RealTimeAlertProcessor {
  constructor() {
    this.activeAlerts = new Map(); // symbol -> alert data
    this.processedAlerts = new Set(); // Track processed alerts to avoid duplicates
    this.isProcessing = false;
  }

  async loadAlertsFromRedis(userId) {
    try {
      const alerts = await AlertsCache.getUserAlerts(userId);
      if (alerts && alerts.length > 0) {
        console.log(
          `📊 Loaded ${alerts.length} alerts from Redis for user ${userId}`
        );
        return alerts;
      }
      return [];
    } catch (error) {
      console.error("❌ Error loading alerts from Redis:", error);
      return [];
    }
  }

  async loadAllActiveAlerts() {
    try {
      // Get all active alerts from MongoDB (including previously triggered ones)
      const alerts = await Alert.find({
        status: "active",
        // Don't filter by triggered: false - we want retriggerable alerts
      }).lean();

      // Filter alerts to only include those for pairs still in user's favorites
      const validAlerts = [];
      const userFavoritesMap = new Map(); // Cache user favorites

      for (const alert of alerts) {
        // Get user's current favorites (with caching)
        let userFavorites = userFavoritesMap.get(alert.userId);
        if (!userFavorites) {
          userFavorites = await this.getUserFavorites(alert.userId);
          userFavoritesMap.set(alert.userId, userFavorites);
        }

        // Only include alert if the symbol is still in user's favorites
        if (userFavorites && userFavorites.includes(alert.symbol)) {
          validAlerts.push(alert);
        } else {
          // Mark alert as inactive since pair is no longer favorited
          await Alert.findByIdAndUpdate(alert._id, { status: "inactive" });
        }
      }

      // Group valid alerts by symbol for fast lookup
      this.activeAlerts.clear();
      validAlerts.forEach((alert) => {
        if (!this.activeAlerts.has(alert.symbol)) {
          this.activeAlerts.set(alert.symbol, []);
        }
        this.activeAlerts.get(alert.symbol).push(alert);
      });

      return validAlerts;
    } catch (error) {
      console.error("❌ Error loading active alerts:", error);
      return [];
    }
  }

  async processPriceUpdate(priceData) {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const symbol = priceData.symbol;
      const alerts = this.activeAlerts.get(symbol);

      if (!alerts || alerts.length === 0) {
        return;
      }

      // Process each alert for this symbol
      for (const alert of alerts) {
        await this.checkAlertConditions(alert, priceData);
      }
    } catch (error) {
      console.error(
        `❌ Error processing price update for ${priceData.symbol}:`,
        error
      );
    } finally {
      this.isProcessing = false;
    }
  }

  async checkAlertConditions(alert, priceData) {
    try {
      // Check if alert is locked (temporary lock due to alert count)
      if (isAlertLocked(alert)) {
        return false;
      }

      // Check if we already processed this alert recently (avoid spam)
      const alertKey = `${alert._id}_${Math.floor(priceData.timestamp / 1000)}`; // Round to seconds
      if (this.processedAlerts.has(alertKey)) {
        return false;
      }

      const conditions = alert.conditions;
      let conditionsMet = true;

      // Check Min Daily volume condition (required)
      if (conditions.minDaily && priceData.volume) {
        const minVolume = parseFloat(conditions.minDaily);
        const actualVolume = parseFloat(priceData.volume);

        if (actualVolume < minVolume) {
          conditionsMet = false;
        }
      }

      // Check Change % condition (required)
      if (
        conditionsMet &&
        conditions.changePercent &&
        conditions.changePercent.percentage
      ) {
        const requiredChange = parseFloat(conditions.changePercent.percentage);
        const actualChange = Math.abs(parseFloat(priceData.priceChangePercent));

        if (actualChange < requiredChange) {
          conditionsMet = false;
        }
      }

      // Check Candle conditions (optional)
      if (
        conditionsMet &&
        conditions.candle &&
        conditions.candle.timeframes &&
        conditions.candle.timeframes.length > 0
      ) {
        const candleMatch = this.evaluateCandleConditions(
          conditions.candle,
          priceData
        );
        if (!candleMatch) {
          conditionsMet = false;
        }
      }

      // Check RSI Range conditions (optional)
      if (
        conditionsMet &&
        conditions.rsiRange &&
        conditions.rsiRange.timeframes &&
        conditions.rsiRange.timeframes.length > 0
      ) {
        const rsiMatch = this.evaluateRSIConditions(
          conditions.rsiRange,
          priceData
        );
        if (!rsiMatch) {
          conditionsMet = false;
        }
      }

      // Check Volume conditions (optional)
      if (
        conditionsMet &&
        conditions.volume &&
        conditions.volume.timeframes &&
        conditions.volume.timeframes.length > 0
      ) {
        const volumeMatch = this.evaluateVolumeConditions(
          conditions.volume,
          priceData
        );
        if (!volumeMatch) {
          conditionsMet = false;
        }
      }

      // Check EMA conditions (optional)
      if (
        conditionsMet &&
        conditions.ema &&
        conditions.ema.timeframes &&
        conditions.ema.timeframes.length > 0
      ) {
        const emaMatch = this.evaluateEMAConditions(conditions.ema, priceData);
        if (!emaMatch) {
          conditionsMet = false;
        }
      }

      if (conditionsMet) {
        // Mark as processed immediately to prevent duplicates
        this.processedAlerts.add(alertKey);

        await this.triggerAlert(alert, priceData);

        // Clean up old processed alerts (keep only last 1000)
        if (this.processedAlerts.size > 1000) {
          const oldKeys = Array.from(this.processedAlerts).slice(0, 500);
          oldKeys.forEach((key) => this.processedAlerts.delete(key));
        }
      }

      return conditionsMet;
    } catch (error) {
      console.error(
        `❌ Error checking alert conditions for ${alert.symbol}:`,
        error
      );
      return false;
    }
  }

  async triggerAlert(alert, priceData) {
    try {
      // Check if we already processed this alert recently (prevent spam)
      const alertKey = `${alert._id}_${Math.floor(priceData.timestamp / 1000)}`;
      if (this.processedAlerts.has(alertKey)) {
        return false;
      }

      // Mark this alert as processed for this time period
      this.processedAlerts.add(alertKey);

      // Clean up old processed alerts (keep only last 60 seconds)
      const currentTime = Math.floor(Date.now() / 1000);
      for (const key of this.processedAlerts) {
        const [, timestamp] = key.split("_");
        if (currentTime - parseInt(timestamp) > 60) {
          this.processedAlerts.delete(key);
        }
      }

      // Create alert history entry
      const alertHistory = {
        alertId: alert._id,
        userId: alert.userId,
        symbol: alert.symbol,
        alertConditions: alert.conditions,
        triggerData: {
          price: priceData.price,
          priceChange: priceData.priceChange,
          priceChangePercent: priceData.priceChangePercent,
          volume: priceData.volume,
          high: priceData.high,
          low: priceData.low,
          open: priceData.open,
          close: priceData.close,
          timestamp: priceData.timestamp,
        },
        triggeredAt: new Date(),
        conditions: this.getAlertConditionsText(alert.conditions),
      };

      // Save to AlertHistory
      await AlertHistoryService.createAlertHistory(alertHistory);

      // Update alert lock if alert count is set
      if (
        alert.conditions.alertCount &&
        alert.conditions.alertCount.timeframe
      ) {
        const updatedConditions = updateAlertLock(alert);

        // Update alert conditions with lock (but keep alert active)
        await Alert.findByIdAndUpdate(alert._id, {
          conditions: updatedConditions,
          // Don't mark as triggered - keep alert active for future triggers
          lastTriggeredAt: new Date(),
          lastTriggeredPrice: priceData.price,
          lastTriggeredVolume: priceData.volume,
          lastTriggeredChange: priceData.priceChangePercent,
        });

        console.log(
          `🔒 Alert ${alert._id} for ${alert.symbol} locked until ${updatedConditions.alertCount.lockUntil}`
        );
      } else {
        // Update last triggered info but keep alert active
        await Alert.findByIdAndUpdate(alert._id, {
          lastTriggeredAt: new Date(),
          lastTriggeredPrice: priceData.price,
          lastTriggeredVolume: priceData.volume,
          lastTriggeredChange: priceData.priceChangePercent,
        });
      }

      // Send real-time notification (we'll implement this)
      this.sendRealTimeNotification(alert, priceData, alertHistory);

      return true;
    } catch (error) {
      console.error(`❌ Error triggering alert for ${alert.symbol}:`, error);
      return false;
    }
  }

  getAlertConditionsText(conditions) {
    const parts = [];

    if (conditions.minDaily) {
      parts.push(`Min Daily: ${conditions.minDaily}`);
    }

    if (conditions.changePercent) {
      parts.push(
        `Change: ${conditions.changePercent.percentage}% (${conditions.changePercent.timeframe})`
      );
    }

    if (conditions.alertCount) {
      parts.push(`Alert Count: ${conditions.alertCount.timeframe}`);
    }

    if (conditions.candle) {
      parts.push(`Candle: ${conditions.candle.condition}`);
    }

    if (conditions.rsiRange) {
      parts.push(
        `RSI: ${conditions.rsiRange.condition} ${conditions.rsiRange.level}`
      );
    }

    if (conditions.volume) {
      parts.push(`Volume: ${conditions.volume.condition}`);
    }

    if (conditions.ema) {
      parts.push(`EMA: ${conditions.ema.condition}`);
    }

    return parts.join(", ");
  }

  async sendRealTimeNotification(alert, priceData, alertHistory) {
    try {
      const notification = {
        type: "alert_triggered",
        symbol: alert.symbol,
        price: priceData.price,
        priceChange: priceData.priceChange,
        priceChangePercent: priceData.priceChangePercent,
        volume: priceData.volume,
        high: priceData.high,
        low: priceData.low,
        open: priceData.open,
        close: priceData.close,
        conditions: alertHistory.conditions,
        triggeredAt: alertHistory.triggeredAt,
        alertId: alert._id,
        userId: alert.userId,
      };

      // Send notification to user
      await NotificationService.sendNotification(alert.userId, notification);

      console.log(`📢 Notification: ${alert.symbol} alert triggered!`);
      console.log(`   Price: $${priceData.price}`);
      console.log(`   Change: ${priceData.priceChangePercent}%`);
      console.log(`   Volume: ${priceData.volume}`);
      console.log(`   Conditions: ${alertHistory.conditions}`);
    } catch (error) {
      console.error("❌ Error sending real-time notification:", error);
    }
  }

  // Technical analysis helper methods
  evaluateCandleConditions(candleConditions, priceData) {
    // Simple candle evaluation - can be enhanced
    if (candleConditions.condition === "CANDLE_ABOVE_OPEN") {
      return priceData.close > priceData.open;
    }
    return true;
  }

  evaluateRSIConditions(rsiConditions, priceData) {
    // RSI evaluation - simplified for now
    // In real implementation, you'd calculate RSI from historical data
    return true;
  }

  evaluateVolumeConditions(volumeConditions, priceData) {
    // Volume evaluation - simplified for now
    return true;
  }

  evaluateEMAConditions(emaConditions, priceData) {
    // EMA evaluation - simplified for now
    return true;
  }

  async getUserFavorites(userId) {
    try {
      // First try to get from Redis cache
      const cachedFavorites = await FavoritesCache.getUserFavorites(userId);
      if (cachedFavorites) {
        return cachedFavorites;
      }

      // If not in cache, get from database
      const user = await User.findById(userId).select("favorites").lean();
      if (user && user.favorites) {
        // Cache the result for future use
        await FavoritesCache.setUserFavorites(userId, user.favorites);
        return user.favorites;
      }

      return [];
    } catch (error) {
      console.error(`❌ Error getting favorites for user ${userId}:`, error);
      return [];
    }
  }

  async refreshAlerts() {
    await this.loadAllActiveAlerts();
  }

  // Force refresh alerts when favorites change
  async forceRefreshAlerts() {
    try {
      console.log("🔄 Force refreshing alerts...");
      await this.loadAllActiveAlerts();
      console.log(
        `✅ Refreshed alerts. Active symbols: ${this.activeAlerts.size}`
      );
    } catch (error) {
      console.error("❌ Error refreshing alerts:", error);
    }
  }

  // Remove alerts for a specific symbol when it's unfavorited
  async removeAlertsForSymbol(symbol) {
    try {
      // Remove from active alerts map
      this.activeAlerts.delete(symbol);
      console.log(`🗑️ Removed alerts for ${symbol} from active processing`);
    } catch (error) {
      console.error(`❌ Error removing alerts for ${symbol}:`, error);
    }
  }

  // Remove alerts for a specific user when they clear all favorites
  async removeAlertsForUser(userId) {
    try {
      // Remove all alerts for this user from active processing
      for (const [symbol, alerts] of this.activeAlerts.entries()) {
        const userAlerts = alerts.filter((alert) => alert.userId === userId);
        if (userAlerts.length > 0) {
          const remainingAlerts = alerts.filter(
            (alert) => alert.userId !== userId
          );
          if (remainingAlerts.length > 0) {
            this.activeAlerts.set(symbol, remainingAlerts);
          } else {
            this.activeAlerts.delete(symbol);
          }
        }
      }
      console.log(`🗑️ Removed all alerts from active processing`);
    } catch (error) {
      console.error(`❌ Error removing alerts for user ${userId}:`, error);
    }
  }
}

export default new RealTimeAlertProcessor();
