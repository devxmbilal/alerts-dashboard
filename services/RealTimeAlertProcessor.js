import { AlertsCache, FavoritesCache } from "../utils/redis.js";
import { isAlertLocked, updateAlertLock } from "../utils/alertLock.js";
import AlertHistoryService from "./AlertHistoryService.js";
import NotificationService from "./NotificationService.js";
import Alert from "../models/Alert.js";
import User from "../models/User.js";
import AlertRedisService from "./AlertRedisService.js";

class RealTimeAlertProcessor {
  constructor() {
    this.activeAlerts = new Map(); // symbol -> alert data
    this.processedAlerts = new Set(); // Track processed alerts to avoid duplicates
    this.isProcessing = false;
    this.alertIds = new Set(); // Track which alert IDs are currently active
    this.alertBaselines = new Map(); // Track baseline prices for change calculations
    this.redisSubscribed = false; // Track Redis subscription status
    this.candleData = new Map(); // Track candle data for timeframe-based changes
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

      console.log(
        `📡 Price update received for ${symbol}: Price=${priceData.price}, Volume=${priceData.volume}, Change=${priceData.priceChangePercent}%`
      );

      if (!alerts || alerts.length === 0) {
        console.log(`⚠️ No active alerts found for ${symbol}`);
        return;
      }

      console.log(`🔍 Found ${alerts.length} active alerts for ${symbol}`);

      // Update candle data for all timeframes used by alerts
      const timeframes = new Set();
      for (const alert of alerts) {
        if (
          alert.conditions.changePercent &&
          alert.conditions.changePercent.timeframe
        ) {
          timeframes.add(alert.conditions.changePercent.timeframe);
        }
      }

      // Update candle data for each timeframe
      for (const timeframe of timeframes) {
        this.updateCandleData(symbol, timeframe, priceData);
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
      console.log(
        `🔍 Checking alert conditions for ${alert.symbol} (Alert ID: ${alert._id})`
      );
      console.log(
        `📊 Live data: Price=${priceData.price}, Volume=${priceData.volume}, Change=${priceData.priceChangePercent}%`
      );

      // Check if alert is locked (temporary lock due to alert count)
      if (isAlertLocked(alert)) {
        console.log(
          `🔒 Alert ${alert._id} for ${alert.symbol} is LOCKED (Alert Count condition)`
        );
        return false;
      }

      // Check if we already processed this alert recently (avoid spam)
      const alertKey = `${alert._id}_${Math.floor(priceData.timestamp / 1000)}`; // Round to seconds
      if (this.processedAlerts.has(alertKey)) {
        console.log(
          `⏭️ Alert ${alert._id} for ${alert.symbol} already processed recently`
        );
        return false;
      }

      const conditions = alert.conditions;
      let conditionsMet = true;

      console.log(`📋 Alert conditions:`, JSON.stringify(conditions, null, 2));

      // Check Min Daily volume condition (required)
      if (conditions.minDaily && priceData.volume) {
        const minVolume = parseFloat(conditions.minDaily);
        const actualVolume = parseFloat(priceData.volume);

        console.log(
          `📈 Min Daily Check: Required=${minVolume}, Actual=${actualVolume}`
        );

        if (actualVolume < minVolume) {
          console.log(
            `❌ Min Daily condition FAILED: ${actualVolume} < ${minVolume}`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ Min Daily condition PASSED: ${actualVolume} >= ${minVolume}`
          );
        }
      } else {
        console.log(`⚠️ Min Daily condition not set or volume data missing`);
      }

      // Check Change % condition (required) - Now based on candle timeframe
      if (
        conditionsMet &&
        conditions.changePercent &&
        conditions.changePercent.percentage
      ) {
        const requiredChange = parseFloat(conditions.changePercent.percentage);
        const timeframe = conditions.changePercent.timeframe || "5m";

        console.log(
          `📊 Checking candle change condition: ${requiredChange}% in ${timeframe}`
        );

        // Check if candle meets the change requirement
        const candleChangeMet = this.checkCandleChangeCondition(
          alert.symbol,
          timeframe,
          requiredChange
        );

        if (!candleChangeMet) {
          console.log(
            `❌ Candle Change % condition FAILED: Candle change < ${requiredChange}% in ${timeframe}`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ Candle Change % condition PASSED: Candle change >= ${requiredChange}% in ${timeframe}`
          );
        }
      } else {
        console.log(`⚠️ Change % condition not set or data missing`);
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
        console.log(
          `🚨 ALL CONDITIONS MET! Triggering alert for ${alert.symbol}`
        );
        console.log(
          `🎯 Alert will be triggered with price: ${priceData.price}`
        );

        // Mark as processed immediately to prevent duplicates
        this.processedAlerts.add(alertKey);

        console.log(`🔄 Calling triggerAlert for ${alert.symbol}...`);
        const triggerResult = await this.triggerAlert(alert, priceData);
        console.log(
          `🔄 triggerAlert result for ${alert.symbol}: ${triggerResult}`
        );

        // Clean up old processed alerts (keep only last 1000)
        if (this.processedAlerts.size > 1000) {
          const oldKeys = Array.from(this.processedAlerts).slice(0, 500);
          oldKeys.forEach((key) => this.processedAlerts.delete(key));
        }
      } else {
        console.log(
          `❌ CONDITIONS NOT MET for ${alert.symbol} - Alert will NOT trigger`
        );
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
      console.log(
        `🚀 Starting triggerAlert for ${alert.symbol} (Alert ID: ${alert._id})`
      );

      // Check if we already processed this alert recently (prevent spam)
      const alertKey = `${alert._id}_${Math.floor(priceData.timestamp / 1000)}`;
      if (this.processedAlerts.has(alertKey)) {
        console.log(
          `⚠️ Alert ${alert._id} already processed recently, but continuing with history save`
        );
        // Don't return false - continue with history saving
      } else {
        // Mark this alert as processed for this time period
        this.processedAlerts.add(alertKey);
        console.log(`✅ Alert ${alert._id} marked as processed`);
      }

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
      console.log(`📝 Saving alert history for ${alert.symbol}...`);
      console.log(
        `📝 Alert history data:`,
        JSON.stringify(alertHistory, null, 2)
      );

      // Check if we already saved this alert recently (prevent duplicate history entries)
      const historyKey = `history_${alert._id}_${Math.floor(
        Date.now() / 60000
      )}`; // 1 minute window
      if (this.processedAlerts.has(historyKey)) {
        console.log(
          `⚠️ Alert history for ${alert._id} already saved recently, skipping duplicate`
        );
      } else {
        try {
          const savedHistory = await AlertHistoryService.createAlertHistory(
            alertHistory
          );
          console.log(
            `✅ Alert history saved successfully: ${savedHistory._id}`
          );
          console.log(`✅ Alert history details:`, {
            id: savedHistory._id,
            symbol: savedHistory.symbol,
            price: savedHistory.triggerData.price,
            triggeredAt: savedHistory.triggeredAt,
          });

          // Mark history as saved
          this.processedAlerts.add(historyKey);
        } catch (historyError) {
          console.error(
            `❌ Error saving alert history for ${alert.symbol}:`,
            historyError
          );
          console.error(`❌ History error details:`, historyError.message);
          console.error(`❌ History error stack:`, historyError.stack);
          // Don't throw error, continue with alert processing
        }
      }

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

      // Clean up candle data for this symbol
      for (const [key, candle] of this.candleData.entries()) {
        if (key.startsWith(`${symbol}_`)) {
          this.candleData.delete(key);
        }
      }

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

  // Add a new alert to active monitoring
  async addAlert(alertId) {
    try {
      console.log(`➕ Adding alert ${alertId} to active monitoring...`);

      const alert = await Alert.findById(alertId).lean();
      if (!alert) {
        console.log(`❌ Alert ${alertId} not found in database`);
        return false;
      }

      if (alert.status !== "active") {
        console.log(
          `❌ Alert ${alertId} is not active (status: ${alert.status})`
        );
        return false;
      }

      // Check if user still has this symbol in favorites
      const userFavorites = await this.getUserFavorites(alert.userId);
      if (!userFavorites || !userFavorites.includes(alert.symbol)) {
        console.log(
          `❌ Alert ${alertId} for ${alert.symbol} not in user favorites`
        );
        return false;
      }

      // Add to active alerts
      const symbol = alert.symbol;
      if (!this.activeAlerts.has(symbol)) {
        this.activeAlerts.set(symbol, []);
      }

      // Check if alert already exists
      const existingAlerts = this.activeAlerts.get(symbol);
      const alertExists = existingAlerts.some(
        (a) => a._id.toString() === alertId
      );

      if (!alertExists) {
        this.activeAlerts.get(symbol).push(alert);
        this.alertIds.add(alertId);

        // Reset baseline for this alert (new conditions = new baseline)
        const alertKey = `${alertId}_${symbol}`;
        this.alertBaselines.delete(alertKey);
        console.log(
          `🔄 Reset baseline for alert ${alertId} (new conditions detected)`
        );

        console.log(
          `✅ Alert ${alertId} for ${alert.symbol} added to active monitoring`
        );
        return true;
      } else {
        console.log(
          `⚠️ Alert ${alertId} for ${alert.symbol} already exists in active monitoring`
        );
        return false;
      }
    } catch (error) {
      console.error(`❌ Error adding alert ${alertId}:`, error);
      return false;
    }
  }

  // Remove an alert from active monitoring
  async removeAlert(alertId) {
    try {
      console.log(`➖ Removing alert ${alertId} from active monitoring...`);

      // Find and remove from activeAlerts
      let removed = false;
      for (const [symbol, alerts] of this.activeAlerts.entries()) {
        const alertIndex = alerts.findIndex(
          (a) => a._id.toString() === alertId
        );
        if (alertIndex !== -1) {
          alerts.splice(alertIndex, 1);
          removed = true;
          console.log(
            `✅ Alert ${alertId} for ${symbol} removed from active monitoring`
          );

          // If no more alerts for this symbol, remove the symbol entry
          if (alerts.length === 0) {
            this.activeAlerts.delete(symbol);
            console.log(
              `🗑️ No more alerts for ${symbol}, removed from monitoring`
            );
          }
          break;
        }
      }

      // Remove from alertIds set
      this.alertIds.delete(alertId);

      // Clean up baseline data for this alert
      for (const [key, baseline] of this.alertBaselines.entries()) {
        if (key.startsWith(`${alertId}_`)) {
          this.alertBaselines.delete(key);
          console.log(`🗑️ Cleaned up baseline data for alert ${alertId}`);
          break;
        }
      }

      // Clean up candle data for this alert's symbol
      for (const [key, candle] of this.candleData.entries()) {
        if (key.startsWith(`${symbol}_`)) {
          this.candleData.delete(key);
          console.log(`🗑️ Cleaned up candle data for ${symbol}`);
        }
      }

      if (!removed) {
        console.log(`⚠️ Alert ${alertId} was not found in active monitoring`);
      }

      return removed;
    } catch (error) {
      console.error(`❌ Error removing alert ${alertId}:`, error);
      return false;
    }
  }

  // Check if an alert is currently being monitored
  isAlertActive(alertId) {
    return this.alertIds.has(alertId);
  }

  // Get count of active alerts
  getActiveAlertCount() {
    return this.alertIds.size;
  }

  // Get count of alerts per symbol
  getAlertsBySymbol() {
    const result = {};
    for (const [symbol, alerts] of this.activeAlerts.entries()) {
      result[symbol] = alerts.length;
    }
    return result;
  }

  // Force reset baseline for a specific alert (when conditions change)
  resetAlertBaseline(alertId, symbol) {
    const alertKey = `${alertId}_${symbol}`;
    this.alertBaselines.delete(alertKey);
    console.log(`🔄 Force reset baseline for alert ${alertId} (${symbol})`);
  }

  // Force reset all baselines (when system restarts or conditions change globally)
  resetAllBaselines() {
    this.alertBaselines.clear();
    this.candleData.clear();
    console.log(`🔄 Reset all alert baselines and candle data`);
  }

  // Convert timeframe string to milliseconds
  getTimeframeMs(timeframe) {
    const timeframes = {
      "1m": 1 * 60 * 1000, // 1 minute
      "2m": 2 * 60 * 1000, // 2 minutes
      "3m": 3 * 60 * 1000, // 3 minutes

      "5MIN": 5 * 60 * 1000, // 5 minutes (alternative format)
      "10m": 10 * 60 * 1000, // 10 minutes
      "15m": 15 * 60 * 1000, // 15 minutes
      "30m": 30 * 60 * 1000, // 30 minutes
      "1h": 60 * 60 * 1000, // 1 hour
      "2h": 2 * 60 * 60 * 1000, // 2 hours
      "4h": 4 * 60 * 60 * 1000, // 4 hours
      "6h": 6 * 60 * 60 * 1000, // 6 hours
      "8h": 8 * 60 * 60 * 1000, // 8 hours
      "12h": 12 * 60 * 60 * 1000, // 12 hours
      "1d": 24 * 60 * 60 * 1000, // 1 day
    };

    return timeframes[timeframe] || timeframes["5m"]; // Default to 5 minutes
  }

  // Get or create candle data for a symbol and timeframe
  getCandleData(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    if (!this.candleData.has(key)) {
      this.candleData.set(key, {
        open: null,
        high: null,
        low: null,
        close: null,
        volume: 0,
        startTime: null,
        endTime: null,
        isComplete: false,
      });
    }
    return this.candleData.get(key);
  }

  // Update candle data with new price
  updateCandleData(symbol, timeframe, priceData) {
    const candle = this.getCandleData(symbol, timeframe);
    const currentTime = Date.now();
    const timeframeMs = this.getTimeframeMs(timeframe);

    // Calculate candle start time (aligned to timeframe)
    const candleStartTime = Math.floor(currentTime / timeframeMs) * timeframeMs;

    // If this is a new candle, reset the candle data
    if (candle.startTime !== candleStartTime) {
      if (candle.startTime !== null) {
        // Previous candle is complete
        candle.isComplete = true;
        console.log(
          `🕯️ Candle completed for ${symbol} (${timeframe}): Open=${
            candle.open
          }, Close=${candle.close}, Change=${this.calculateCandleChange(
            candle
          )}%`
        );
      }

      // Start new candle
      candle.open = parseFloat(priceData.price);
      candle.high = parseFloat(priceData.price);
      candle.low = parseFloat(priceData.price);
      candle.close = parseFloat(priceData.price);
      candle.volume = parseFloat(priceData.volume) || 0;
      candle.startTime = candleStartTime;
      candle.endTime = candleStartTime + timeframeMs;
      candle.isComplete = false;

      console.log(
        `🕯️ New candle started for ${symbol} (${timeframe}): Open=${candle.open}`
      );
    } else {
      // Update existing candle
      const price = parseFloat(priceData.price);
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume += parseFloat(priceData.volume) || 0;

      // Check if current candle meets change requirement (immediate check)
      const currentChange = this.calculateCandleChange(candle);
      console.log(
        `🕯️ Candle updated for ${symbol} (${timeframe}): High=${
          candle.high
        }, Low=${candle.low}, Close=${
          candle.close
        }, Current Change=${currentChange.toFixed(3)}%`
      );
    }

    return candle;
  }

  // Calculate percentage change for a candle
  calculateCandleChange(candle) {
    if (!candle.open || !candle.close) return 0;
    return ((candle.close - candle.open) / candle.open) * 100;
  }

  // Check if a candle meets the change percentage requirement
  checkCandleChangeCondition(symbol, timeframe, requiredChange) {
    const candle = this.getCandleData(symbol, timeframe);

    console.log(`🔍 Checking candle for ${symbol} (${timeframe}):`);
    console.log(`   Candle complete: ${candle.isComplete}`);
    console.log(`   Open: ${candle.open}, Close: ${candle.close}`);
    console.log(
      `   Start time: ${candle.startTime}, End time: ${candle.endTime}`
    );

    // Check if we have valid candle data
    if (!candle.open || !candle.close) {
      console.log(
        `❌ Candle not ready: Open=${candle.open}, Close=${candle.close}`
      );
      return false;
    }

    const changePercent = this.calculateCandleChange(candle);
    const absoluteChange = Math.abs(changePercent);

    console.log(`📊 Candle Change Check for ${symbol} (${timeframe}):`);
    console.log(`   Open: ${candle.open}, Close: ${candle.close}`);
    console.log(
      `   Change: ${changePercent.toFixed(3)}%, Required: ${requiredChange}%`
    );
    console.log(`   Absolute Change: ${absoluteChange.toFixed(3)}%`);

    const meetsRequirement = absoluteChange >= requiredChange;
    console.log(`   Result: ${meetsRequirement ? "✅ PASSED" : "❌ FAILED"}`);

    return meetsRequirement;
  }

  // Subscribe to Redis alert management events
  async subscribeToAlertManagement() {
    if (this.redisSubscribed) {
      console.log("⚠️ Already subscribed to alert management events");
      return;
    }

    try {
      await AlertRedisService.subscribeToAlertManagement((data) => {
        this.handleAlertManagementEvent(data);
      });
      this.redisSubscribed = true;
      console.log("✅ Subscribed to alert management events");
    } catch (error) {
      console.error("❌ Error subscribing to alert management:", error);
    }
  }

  // Handle Redis alert management events
  async handleAlertManagementEvent(data) {
    try {
      console.log(`📢 Received alert management event:`, data);

      switch (data.type) {
        case "alert_created":
          await this.addAlert(data.alertId);
          break;

        case "alert_removed":
          await this.removeAlert(data.alertId);
          break;

        case "bulk_alerts_created":
          for (const alertId of data.alertIds) {
            await this.addAlert(alertId);
          }
          break;

        case "alerts_cleared":
          await this.removeAlertsForUser(data.userId);
          break;

        case "alerts_removed_for_symbol":
          await this.removeAlertsForSymbol(data.symbol);
          break;

        default:
          console.log(`⚠️ Unknown alert management event type: ${data.type}`);
      }
    } catch (error) {
      console.error("❌ Error handling alert management event:", error);
    }
  }

  // Unsubscribe from Redis alert management events
  async unsubscribeFromAlertManagement() {
    if (!this.redisSubscribed) {
      console.log("⚠️ Not subscribed to alert management events");
      return;
    }

    try {
      await AlertRedisService.unsubscribeFromAlertManagement();
      this.redisSubscribed = false;
      console.log("✅ Unsubscribed from alert management events");
    } catch (error) {
      console.error("❌ Error unsubscribing from alert management:", error);
    }
  }
}

export default new RealTimeAlertProcessor();
