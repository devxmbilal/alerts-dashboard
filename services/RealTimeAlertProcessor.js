import { AlertsCache, FavoritesCache } from "../utils/redis.js";
import { isAlertLocked, updateAlertLock } from "../utils/alertLock.js";
import AlertHistoryService from "./AlertHistoryService.js";
import NotificationService from "./NotificationService.js";
import EmailService from "./EmailService.js";
import TelegramService from "./TelegramService.js";
import ChartScreenshotService from "../utils/chartScreenshot.js";
import Alert from "../models/Alert.js";
import AlertHistory from "../models/AlertHistory.js";
import User from "../models/User.js";
import AlertRedisService from "./AlertRedisService.js";
import pLimit from "p-limit";
import dotenv from "dotenv";
dotenv.config();
class RealTimeAlertProcessor {
  constructor() {
    this.activeAlerts = new Map(); // symbol -> alert data
    this.processedAlerts = new Set(); // Track processed alerts to avoid duplicates
    this.isProcessing = false;
    this.alertIds = new Set(); // Track which alert IDs are currently active
    this.alertBaselines = new Map(); // Track baseline prices for change calculations
    this.redisSubscribed = false; // Track Redis subscription status
    this.candleData = new Map(); // Track candle data for timeframe-based changes
    this.currentRound = 0; // Track current processing round
    this.isRoundProcessing = false; // Prevent overlapping rounds
    this.roundInterval = null; // Round processing interval
    // Concurrency limit for parallel alert processing (20-50 alerts at once)
    this.processLimit = pLimit(50);
    this.rsiData = new Map(); // Track RSI values for each symbol+timeframe: key = "symbol_timeframe_period", value = { current: number, previous: number }
    this.openInterestData = new Map(); // Track Open Interest for each symbol+timeframe: key = "symbol_timeframe", value = { current: number, baseline: number, timestamp: number }
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

  // Task 1: Round-based processing - fetch all alerts from database and process them
  async startRoundBasedProcessing() {
    console.log("🔄 Starting round-based alert processing...");

    // Process every 30 seconds
    this.roundInterval = setInterval(async () => {
      await this.processRound();
    }, 30000); // 30 seconds interval

    // Also process immediately
    await this.processRound();
  }

  async processRound() {
    if (this.isRoundProcessing) {
      console.log("⏳ Round processing already in progress, skipping...");
      return;
    }

    this.isRoundProcessing = true;
    this.currentRound++;

    try {
      console.log(
        `🔄 Starting Round ${this.currentRound} - Fetching fresh alerts from database...`
      );

      // Step 1: Fetch ALL active alerts from database with latest data
      const freshAlerts = await this.loadAllActiveAlerts();
      console.log(
        `📊 Round ${this.currentRound}: Loaded ${freshAlerts.length} active alerts from database`
      );

      if (freshAlerts.length === 0) {
        console.log("⚠️ No active alerts found, skipping round");
        this.isRoundProcessing = false;
        return;
      }

      // Step 2: Get current live prices for all symbols
      const livePrices = await this.getCurrentLivePrices();
      console.log(
        `📡 Round ${this.currentRound}: Fetched live prices for ${
          Object.keys(livePrices).length
        } symbols`
      );

      // Step 3: Process each alert with live data in parallel (with concurrency limit)
      // Process alerts in parallel with concurrency limit (up to 50 at once)
      const alertPromises = freshAlerts.map((alert) =>
        this.processLimit(async () => {
          try {
            const liveData = livePrices[alert.symbol];
            if (liveData) {
              const result = await this.processAlertWithLiveData(
                alert,
                liveData
              );
              return result;
            }
            return { triggered: false, reason: "no_live_data" };
          } catch (error) {
            console.error(
              `❌ Error processing alert ${alert._id} for ${alert.symbol}:`,
              error.message
            );
            return { triggered: false, reason: "error", error: error.message };
          }
        })
      );

      // Wait for all alerts to be processed (with concurrency limit)
      const results = await Promise.all(alertPromises);

      // Count processed and triggered alerts from results
      const processedCount = results.length;
      const triggeredCount = results.filter(
        (r) => r && r.triggered === true
      ).length;

      console.log(
        `✅ Round ${this.currentRound} completed: Processed ${processedCount} alerts, ${triggeredCount} triggered`
      );
    } catch (error) {
      console.error(`❌ Error in Round ${this.currentRound}:`, error);
    } finally {
      this.isRoundProcessing = false;
    }
  }

  // Task 2: Process alert with live data - check baseline price comparison
  async processAlertWithLiveData(alert, liveData) {
    try {
      console.log(`🔍 Processing alert ${alert._id} for ${alert.symbol}`);
      console.log(
        `📊 Baseline: ${alert.baselinePrice}, Live: ${liveData.price}`
      );

      // CRITICAL: Check if baseline needs to be updated based on timeframe
      // If timeframe interval has passed, update baseline to current live price
      if (alert.conditions?.changePercent?.timeframe) {
        const timeframe = alert.conditions.changePercent.timeframe;
        const timeframeMs = this.getTimeframeMs(timeframe);
        const baselineTimestamp = alert.baselineTimestamp
          ? new Date(alert.baselineTimestamp).getTime()
          : Date.now();
        const currentTime = Date.now();
        const timeSinceBaseline = currentTime - baselineTimestamp;

        // Check if timeframe interval has passed
        if (timeSinceBaseline >= timeframeMs) {
          console.log(
            `⏰ Timeframe interval (${timeframe}) has passed for ${alert.symbol}`
          );
          console.log(
            `📊 Updating baseline: ${alert.baselinePrice} → ${liveData.price}`
          );

          // Update baseline to current live price
          alert.baselinePrice = liveData.price;
          alert.baselineVolume = liveData.volume || liveData.volume24h;
          alert.baselineTimestamp = new Date();

          // Update in database (non-blocking)
          Alert.findByIdAndUpdate(alert._id, {
            baselinePrice: liveData.price,
            baselineVolume: liveData.volume || liveData.volume24h,
            baselineTimestamp: new Date(),
          }).catch((error) => {
            console.error(
              `❌ Error updating baseline for ${alert.symbol}:`,
              error.message
            );
          });

          // Update in activeAlerts map
          const alertsForSymbol = this.activeAlerts.get(alert.symbol);
          if (alertsForSymbol) {
            const alertIndex = alertsForSymbol.findIndex(
              (a) => a._id.toString() === alert._id.toString()
            );
            if (alertIndex !== -1) {
              alertsForSymbol[alertIndex] = alert;
            }
          }

          console.log(
            `✅ Baseline updated for ${alert.symbol}: New baseline = ${liveData.price}`
          );
        } else {
          const remainingMs = timeframeMs - timeSinceBaseline;
          const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
          console.log(
            `⏰ Timeframe interval (${timeframe}) not yet reached for ${alert.symbol}`
          );
          console.log(
            `   Remaining time: ${remainingMinutes} minutes (${Math.ceil(
              remainingMs / 1000
            )} seconds)`
          );
        }
      }

      // FIRST: Check if alert is locked (prevent duplicate triggers)
      if (isAlertLocked(alert)) {
        const lockUntil = new Date(alert.conditions.alertCount.lockUntil);
        const now = new Date();
        const timeRemaining = Math.max(0, lockUntil.getTime() - now.getTime());
        const minutesRemaining = Math.ceil(timeRemaining / (1000 * 60));

        console.log(
          `🔒 Alert ${alert._id} for ${
            alert.symbol
          } is LOCKED until ${lockUntil.toISOString()}`
        );
        console.log(
          `⏰ Lock time remaining: ${minutesRemaining} minutes (${Math.ceil(
            timeRemaining / 1000
          )} seconds)`
        );
        return { triggered: false, reason: "alert_locked" };
      }

      // Check price direction based on alert settings
      const direction =
        alert.conditions?.changePercent?.direction || "increase";
      const priceChanged = liveData.price !== alert.baselinePrice;

      if (direction === "increase" && liveData.price <= alert.baselinePrice) {
        console.log(
          `❌ Direction: INCREASE - Live price ${liveData.price} <= baseline ${alert.baselinePrice}, skipping alert`
        );
        return { triggered: false, reason: "price_not_increased" };
      }

      if (direction === "decrease" && liveData.price >= alert.baselinePrice) {
        console.log(
          `❌ Direction: DECREASE - Live price ${liveData.price} >= baseline ${alert.baselinePrice}, skipping alert`
        );
        return { triggered: false, reason: "price_not_decreased" };
      }

      if (!priceChanged) {
        console.log(
          `❌ Price hasn't changed from baseline ${alert.baselinePrice}, skipping alert`
        );
        return { triggered: false, reason: "price_unchanged" };
      }

      console.log(
        `✅ Price condition met - Direction: ${direction.toUpperCase()}, Baseline: ${
          alert.baselinePrice
        }, Live: ${liveData.price}`
      );

      // Check alert conditions
      const conditionsMet = await this.checkAlertConditionsWithLiveData(
        alert,
        liveData
      );

      if (conditionsMet) {
        console.log(
          `🚨 Alert ${alert._id} conditions met! Triggering alert...`
        );

        // Trigger the alert (this will apply the lock)
        await this.triggerAlertWithLiveData(alert, liveData);

        return { triggered: true, reason: "conditions_met" };
      } else {
        console.log(`❌ Alert ${alert._id} conditions not met`);
        return { triggered: false, reason: "conditions_not_met" };
      }
    } catch (error) {
      console.error(`❌ Error processing alert ${alert._id}:`, error);
      return { triggered: false, reason: "error", error: error.message };
    }
  }

  // Check conditions with live data
  async checkAlertConditionsWithLiveData(alert, liveData) {
    try {
      const conditions = alert.conditions;
      let conditionsMet = true;

      console.log(
        `📋 Checking conditions for ${alert.symbol}:`,
        JSON.stringify(conditions, null, 2)
      );

      // Check Min Daily volume condition (required)
      if (conditions.minDaily && (liveData.volume || liveData.volume24h)) {
        const minVolume = parseFloat(conditions.minDaily);
        const actualVolume = parseFloat(liveData.volume || liveData.volume24h);

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

      // Check Change % condition (required) - based on baseline price and direction
      if (
        conditionsMet &&
        conditions.changePercent &&
        conditions.changePercent.percentage
      ) {
        const requiredChange = parseFloat(conditions.changePercent.percentage);
        const timeframe = conditions.changePercent.timeframe || "5m";
        const direction = conditions.changePercent.direction || "increase";

        console.log(
          `📊 Checking change condition: ${requiredChange}% ${direction.toUpperCase()} in ${timeframe}`
        );

        // Calculate change from baseline price
        const changeFromBaseline =
          ((liveData.price - alert.baselinePrice) / alert.baselinePrice) * 100;
        const absoluteChange = Math.abs(changeFromBaseline);

        console.log(
          `📊 Change Check: Baseline=${alert.baselinePrice}, Live=${liveData.price}`
        );
        console.log(
          `📊 Change from baseline: ${changeFromBaseline.toFixed(
            3
          )}%, Required: ${requiredChange}%`
        );

        // Check based on direction
        let directionMet = true;

        if (direction === "increase" && changeFromBaseline < 0) {
          console.log(
            `❌ Direction condition FAILED: Price decreased but increase required`
          );
          directionMet = false;
        } else if (direction === "decrease" && changeFromBaseline > 0) {
          console.log(
            `❌ Direction condition FAILED: Price increased but decrease required`
          );
          directionMet = false;
        }

        if (!directionMet || absoluteChange < requiredChange) {
          console.log(
            `❌ Change % condition FAILED: ${absoluteChange.toFixed(
              3
            )}% < ${requiredChange}% or wrong direction`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ Change % condition PASSED: ${absoluteChange.toFixed(
              3
            )}% >= ${requiredChange}% with correct direction (${direction})`
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
        const candleCondition =
          conditions.candle.condition || "CANDLE_ABOVE_OPEN";
        console.log(
          `🕯️ Checking Candle condition: ${candleCondition} on timeframes: ${conditions.candle.timeframes.join(
            ", "
          )}`
        );

        // CRITICAL: Initialize/update candle data for all required timeframes before evaluation
        for (const timeframe of conditions.candle.timeframes) {
          await this.updateCandleData(alert.symbol, timeframe, liveData);
        }

        // Use the evaluateCandleConditions method for consistent logic
        const candleMatch = await this.evaluateCandleConditions(
          conditions.candle,
          liveData,
          alert.symbol
        );
        if (!candleMatch) {
          console.log(
            `❌ Candle condition FAILED: ${candleCondition} not met for ${conditions.candle.timeframes.join(
              ", "
            )}`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ Candle condition PASSED: ${candleCondition} met for ${conditions.candle.timeframes.join(
              ", "
            )}`
          );
        }
      }

      // Check RSI Range conditions (optional)
      if (
        conditionsMet &&
        conditions.rsiRange &&
        conditions.rsiRange.timeframes &&
        conditions.rsiRange.timeframes.length > 0
      ) {
        console.log(
          `📊 Checking RSI condition: ${conditions.rsiRange.condition} ${
            conditions.rsiRange.level
          } on timeframes: ${conditions.rsiRange.timeframes.join(", ")}`
        );

        // Use the evaluateRSIConditions method for consistent logic
        const rsiMatch = await this.evaluateRSIConditions(
          conditions.rsiRange,
          liveData,
          alert.symbol
        );

        if (!rsiMatch) {
          console.log(
            `❌ RSI condition FAILED: ${conditions.rsiRange.condition} ${
              conditions.rsiRange.level
            } not met for ${conditions.rsiRange.timeframes.join(", ")}`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ RSI condition PASSED: ${conditions.rsiRange.condition} ${conditions.rsiRange.level} met for all timeframes`
          );
        }
      }

      // Check Volume conditions (optional)
      if (
        conditionsMet &&
        conditions.volume &&
        conditions.volume.timeframes &&
        conditions.volume.timeframes.length > 0
      ) {
        console.log(
          `📈 Checking Volume condition: ${conditions.volume.condition}${
            conditions.volume.percentage
              ? ` by ${conditions.volume.percentage}%`
              : ""
          } on timeframes: ${conditions.volume.timeframes.join(", ")}`
        );

        // Use the evaluateVolumeConditions method for consistent logic
        const volumeMatch = await this.evaluateVolumeConditions(
          conditions.volume,
          liveData,
          alert.symbol,
          alert
        );

        if (!volumeMatch) {
          console.log(
            `❌ Volume condition FAILED: ${
              conditions.volume.condition
            } not met for ${conditions.volume.timeframes.join(", ")}`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ Volume condition PASSED: ${conditions.volume.condition} met for all timeframes`
          );
        }
      }

      // Check OPEN INTEREST conditions (optional)
      if (
        conditionsMet &&
        conditions.openInterest &&
        conditions.openInterest.timeframes &&
        conditions.openInterest.timeframes.length > 0
      ) {
        const openInterestMatch = await this.evaluateOpenInterestConditions(
          conditions.openInterest,
          alert,
          liveData
        );
        if (!openInterestMatch) {
          conditionsMet = false;
        }
      }

      return conditionsMet;
    } catch (error) {
      console.error(`❌ Error checking conditions for ${alert.symbol}:`, error);
      return false;
    }
  }

  // Trigger alert with live data and update baseline
  async triggerAlertWithLiveData(alert, liveData) {
    try {
      console.log(
        `🚀 Triggering alert ${alert._id} for ${alert.symbol} with live data`
      );

      // Safely get baseline values with proper defaults
      const baselinePrice = parseFloat(alert.baselinePrice) || 0;
      const baselineVolume = parseFloat(alert.baselineVolume) || 0;
      const baselineTimestamp = alert.baselineTimestamp || new Date();
      const livePrice = parseFloat(liveData.price) || 0;

      // Calculate change from baseline with proper NaN handling
      let changeFromBaseline = 0;
      let changeFromBaselinePercent = 0;

      if (baselinePrice > 0 && livePrice > 0) {
        changeFromBaseline = livePrice - baselinePrice;
        changeFromBaselinePercent = (changeFromBaseline / baselinePrice) * 100;

        // Handle NaN or Infinity cases
        if (!isFinite(changeFromBaseline)) changeFromBaseline = 0;
        if (!isFinite(changeFromBaselinePercent)) changeFromBaselinePercent = 0;
      }

      // Debug: Log live data and alert data

      // Determine direction based on price change
      const direction =
        changeFromBaselinePercent > 0
          ? "increase"
          : changeFromBaselinePercent < 0
          ? "decrease"
          : "both";

      // Create alert history entry with all required fields
      const alertHistory = {
        alertId: alert._id,
        userId: alert.userId,
        symbol: alert.symbol,
        alertConditions: {
          ...alert.conditions,
          changePercent: {
            ...alert.conditions.changePercent,
            direction: direction,
          },
        },
        triggerData: {
          price: parseFloat(liveData.price) || 0,
          priceChange: parseFloat(liveData.priceChange) || 0,
          priceChangePercent: parseFloat(liveData.priceChangePercent) || 0,
          volume24h: parseFloat(liveData.volume || liveData.volume24h) || 0,
          high: parseFloat(liveData.high || liveData.price) || 0,
          low: parseFloat(liveData.low || liveData.price) || 0,
          open: parseFloat(liveData.open || liveData.price) || 0,
          close: parseFloat(liveData.close || liveData.price) || 0,
          timestamp: liveData.timestamp || Date.now(),
        },
        baselineData: {
          baselinePrice: baselinePrice,
          baselineVolume: baselineVolume,
          baselineTimestamp: baselineTimestamp,
          changeFromBaseline: changeFromBaseline,
          changeFromBaselinePercent: changeFromBaselinePercent,
        },
        triggeredAt: new Date(),
        conditions: this.getAlertConditionsText(alert.conditions),
      };

      // Save to AlertHistory
      console.log(`📝 Saving alert history for ${alert.symbol}...`);
      const savedAlertHistory = await AlertHistoryService.createAlertHistory(
        alertHistory
      );

      // CRITICAL: Use saved alert history with _id for notification
      if (!savedAlertHistory || !savedAlertHistory._id) {
        console.error(
          `❌ Failed to save alert history for ${alert.symbol}, cannot send notifications`
        );
        return false;
      }

      console.log(
        `✅ Alert history saved: ${savedAlertHistory._id} for ${alert.symbol}`
      );

      // Update alert with latest price and new baseline
      const updateData = {
        lastTriggeredAt: new Date(),
        lastTriggeredPrice: liveData.price,
        lastTriggeredVolume: liveData.volume || liveData.volume24h,
        // Update baseline to current live price for next round
        baselinePrice: liveData.price,
        baselineVolume: liveData.volume || liveData.volume24h,
        baselineTimestamp: new Date(),
      };

      // Update alert lock if alert count is set
      if (
        alert.conditions.alertCount &&
        alert.conditions.alertCount.timeframe
      ) {
        const updatedConditions = updateAlertLock(alert);
        updateData.conditions = updatedConditions;

        console.log(
          `🔒 Alert ${alert._id} LOCKED for ${alert.conditions.alertCount.timeframe} until ${updatedConditions.alertCount.lockUntil}`
        );
        console.log(
          `⏰ Next trigger allowed after: ${updatedConditions.alertCount.lockUntil}`
        );
      }

      await Alert.findByIdAndUpdate(alert._id, updateData);

      console.log(
        `✅ Alert ${alert._id} updated with new baseline price: ${liveData.price}`
      );

      // Log savedAlertHistory before sending notification
      console.log(
        `📤 About to send notification for ${alert.symbol}, savedAlertHistory:`,
        {
          _id: savedAlertHistory._id,
          symbol: savedAlertHistory.symbol,
          notificationSent: savedAlertHistory.notificationSent,
          notificationSentTelegram:
            savedAlertHistory.notificationSent?.telegram,
        }
      );

      // Send real-time notification using saved alert history (with _id)
      // Fire and forget - don't block alert processing for notifications
      // This allows Telegram notifications to be sent in parallel without blocking
      this.sendRealTimeNotification(alert, liveData, savedAlertHistory).catch(
        (error) => {
          console.error(
            `❌ Error sending notification for ${alert.symbol} (non-blocking):`,
            error.message
          );
        }
      );

      return true;
    } catch (error) {
      console.error(`❌ Error triggering alert ${alert._id}:`, error);
      return false;
    }
  }

  // Get current live prices for all active symbols
  async getCurrentLivePrices() {
    try {
      const livePrices = {};
      const symbols = Array.from(this.activeAlerts.keys());

      // Try to get from Redis cache first
      const redis = await import("../utils/redis.js");

      for (const symbol of symbols) {
        try {
          let priceData = await redis.default.get(`crypto:${symbol}`);
          if (!priceData) {
            priceData = await redis.default.get(
              `crypto:${symbol.toLowerCase()}`
            );
          }

          if (priceData) {
            const data = JSON.parse(priceData);
            livePrices[symbol] = {
              price: parseFloat(data.price),
              volume:
                parseFloat(data.volume) || parseFloat(data.volume24h) || 0,
              volume24h:
                parseFloat(data.volume24h) || parseFloat(data.volume) || 0,
              priceChange: parseFloat(data.priceChange) || 0,
              priceChangePercent: parseFloat(data.priceChangePercent) || 0,
              high: parseFloat(data.high) || parseFloat(data.price),
              low: parseFloat(data.low) || parseFloat(data.price),
              open: parseFloat(data.open) || parseFloat(data.price),
              close: parseFloat(data.close) || parseFloat(data.price),
              timestamp: data.timestamp || Date.now(),
            };
          }
        } catch (error) {
          console.warn(
            `⚠️ Could not get live price for ${symbol}:`,
            error.message
          );
        }
      }

      // Fallback: If no Redis data, fetch from Binance API
      if (Object.keys(livePrices).length === 0) {
        console.log("📊 No Redis data found, fetching from Binance API...");
        try {
          const response = await fetch(
            "https://api.binance.com/api/v3/ticker/24hr"
          );
          const tickers = await response.json();

          for (const symbol of symbols) {
            const ticker = tickers.find((t) => t.symbol === symbol);
            if (ticker) {
              livePrices[symbol] = {
                price: parseFloat(ticker.lastPrice),
                volume: parseFloat(ticker.volume),
                volume24h: parseFloat(ticker.volume),
                priceChange: parseFloat(ticker.priceChange),
                priceChangePercent: parseFloat(ticker.priceChangePercent),
                high: parseFloat(ticker.highPrice),
                low: parseFloat(ticker.lowPrice),
                open: parseFloat(ticker.openPrice),
                close: parseFloat(ticker.lastPrice),
                timestamp: Date.now(),
              };
            }
          }
        } catch (apiError) {
          console.warn("⚠️ Error fetching from Binance API:", apiError.message);
        }
      }

      return livePrices;
    } catch (error) {
      console.error("❌ Error getting current live prices:", error);
      return {};
    }
  }

  async processPriceUpdate(priceData) {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const symbol = priceData.symbol;
      const alerts = this.activeAlerts.get(symbol);

      console.log(
        `📡 Price update received for ${symbol}: Price=${
          priceData.price
        }, Volume=${priceData.volume || priceData.volume24h}, Change=${
          priceData.priceChangePercent
        }%`
      );

      if (!alerts || alerts.length === 0) {
        console.log(`⚠️ No active alerts found for ${symbol}`);
        return;
      }

      console.log(`🔍 Found ${alerts.length} active alerts for ${symbol}`);

      // Update candle data for all timeframes used by alerts
      // Include timeframes from both changePercent and candle conditions
      const timeframes = new Set();
      for (const alert of alerts) {
        // Add changePercent timeframes
        if (
          alert.conditions.changePercent &&
          alert.conditions.changePercent.timeframe
        ) {
          timeframes.add(alert.conditions.changePercent.timeframe);
        }
        // Add candle condition timeframes
        if (
          alert.conditions.candle &&
          alert.conditions.candle.timeframes &&
          Array.isArray(alert.conditions.candle.timeframes)
        ) {
          for (const tf of alert.conditions.candle.timeframes) {
            timeframes.add(tf);
          }
        }
      }

      // Update candle data for each timeframe
      for (const timeframe of timeframes) {
        await this.updateCandleData(symbol, timeframe, priceData);
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
        `📊 Live data: Price=${priceData.price}, Volume=${priceData.volume24h}, Change=${priceData.priceChangePercent}%`
      );
      console.log(
        `📊 Baseline: Price=${alert.baselinePrice}, Volume=${alert.baselineVolume}, Timestamp=${alert.baselineTimestamp}`
      );

      // CRITICAL: Check if baseline needs to be updated based on timeframe
      // If timeframe interval has passed, update baseline to current live price
      if (alert.conditions?.changePercent?.timeframe) {
        const timeframe = alert.conditions.changePercent.timeframe;
        const timeframeMs = this.getTimeframeMs(timeframe);
        const baselineTimestamp = alert.baselineTimestamp
          ? new Date(alert.baselineTimestamp).getTime()
          : Date.now();
        const currentTime = Date.now();
        const timeSinceBaseline = currentTime - baselineTimestamp;

        // Check if timeframe interval has passed
        if (timeSinceBaseline >= timeframeMs) {
          console.log(
            `⏰ Timeframe interval (${timeframe}) has passed for ${alert.symbol}`
          );
          console.log(
            `📊 Updating baseline: ${alert.baselinePrice} → ${priceData.price}`
          );

          // Update baseline to current live price
          alert.baselinePrice = priceData.price;
          alert.baselineVolume = priceData.volume || priceData.volume24h;
          alert.baselineTimestamp = new Date();

          // Update in database (non-blocking)
          Alert.findByIdAndUpdate(alert._id, {
            baselinePrice: priceData.price,
            baselineVolume: priceData.volume || priceData.volume24h,
            baselineTimestamp: new Date(),
          }).catch((error) => {
            console.error(
              `❌ Error updating baseline for ${alert.symbol}:`,
              error.message
            );
          });

          // Update in activeAlerts map
          const alertsForSymbol = this.activeAlerts.get(alert.symbol);
          if (alertsForSymbol) {
            const alertIndex = alertsForSymbol.findIndex(
              (a) => a._id.toString() === alert._id.toString()
            );
            if (alertIndex !== -1) {
              alertsForSymbol[alertIndex] = alert;
            }
          }

          console.log(
            `✅ Baseline updated for ${alert.symbol}: New baseline = ${priceData.price}`
          );
        } else {
          const remainingMs = timeframeMs - timeSinceBaseline;
          const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
          console.log(
            `⏰ Timeframe interval (${timeframe}) not yet reached for ${alert.symbol}`
          );
          console.log(
            `   Remaining time: ${remainingMinutes} minutes (${Math.ceil(
              remainingMs / 1000
            )} seconds)`
          );
        }
      }

      // Check if alert is locked (temporary lock due to alert count)
      if (isAlertLocked(alert)) {
        const lockUntil = new Date(alert.conditions.alertCount.lockUntil);
        const now = new Date();
        const timeRemaining = Math.max(0, lockUntil.getTime() - now.getTime());
        const minutesRemaining = Math.ceil(timeRemaining / (1000 * 60));

        console.log(
          `🔒 Alert ${alert._id} for ${
            alert.symbol
          } is LOCKED until ${lockUntil.toISOString()}`
        );
        console.log(
          `⏰ Time remaining: ${minutesRemaining} minutes (${Math.ceil(
            timeRemaining / 1000
          )} seconds)`
        );
        return false;
      }

      // IMPORTANT: Check price direction based on alert settings
      const direction =
        alert.conditions?.changePercent?.direction || "increase";
      const priceChanged = priceData.price !== alert.baselinePrice;

      console.log(
        `📊 Direction Check: Required=${direction}, Baseline=${alert.baselinePrice}, Live=${priceData.price}`
      );

      if (direction === "increase" && priceData.price <= alert.baselinePrice) {
        console.log(
          `❌ Direction: INCREASE - Live price ${priceData.price} <= baseline ${alert.baselinePrice}, skipping alert`
        );
        return false;
      }

      if (direction === "decrease" && priceData.price >= alert.baselinePrice) {
        console.log(
          `❌ Direction: DECREASE - Live price ${priceData.price} >= baseline ${alert.baselinePrice}, skipping alert`
        );
        return false;
      }

      if (!priceChanged) {
        console.log(
          `❌ Price hasn't changed from baseline ${alert.baselinePrice}, skipping alert`
        );
        return false;
      }

      console.log(
        `✅ Direction condition met: ${direction.toUpperCase()} - Price moved from ${
          alert.baselinePrice
        } to ${priceData.price}`
      );

      const conditions = alert.conditions;
      let conditionsMet = true;

      console.log(`📋 Alert conditions:`, JSON.stringify(conditions, null, 2));

      // Check Min Daily volume condition (required)
      if (conditions.minDaily && (priceData.volume || priceData.volume24h)) {
        const minVolume = parseFloat(conditions.minDaily);
        const actualVolume = parseFloat(
          priceData.volume || priceData.volume24h
        );

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

        // Check if candle meets the change requirement using baseline price
        if (!alert.baselinePrice || alert.baselinePrice === 0) {
          console.log(
            `❌ Candle Change % condition FAILED: Baseline price is 0 or missing`
          );
          conditionsMet = false;
        } else {
          const candleChangeMet = this.checkCandleChangeCondition(
            alert.symbol,
            timeframe,
            requiredChange,
            alert.baselinePrice
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
        // CRITICAL: Initialize/update candle data for all required timeframes before evaluation
        for (const timeframe of conditions.candle.timeframes) {
          await this.updateCandleData(alert.symbol, timeframe, priceData);
        }

        const candleMatch = await this.evaluateCandleConditions(
          conditions.candle,
          priceData,
          alert.symbol
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
        const rsiMatch = await this.evaluateRSIConditions(
          conditions.rsiRange,
          priceData,
          alert.symbol
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
        const volumeMatch = await this.evaluateVolumeConditions(
          conditions.volume,
          priceData,
          alert.symbol,
          alert
        );
        if (!volumeMatch) {
          conditionsMet = false;
        }
      }

      // Check OPEN INTEREST conditions (optional)
      if (
        conditionsMet &&
        conditions.openInterest &&
        conditions.openInterest.timeframes &&
        conditions.openInterest.timeframes.length > 0
      ) {
        const openInterestMatch = await this.evaluateOpenInterestConditions(
          conditions.openInterest,
          alert,
          priceData
        );
        if (!openInterestMatch) {
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

        console.log(`🔄 Calling triggerAlert for ${alert.symbol}...`);
        const triggerResult = await this.triggerAlert(alert, priceData);
        console.log(
          `🔄 triggerAlert result for ${alert.symbol}: ${triggerResult}`
        );
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

      // Create unique key for duplicate checking
      const alertKey = `${alert._id}_${Math.floor(priceData.timestamp / 1000)}`;

      // Check if we already processed this alert recently (prevent spam)
      if (this.processedAlerts.has(alertKey)) {
        console.log(
          `⚠️ Alert ${alert._id} already processed recently (within last 60s), skipping duplicate trigger`
        );
        return false;
      }

      // Safely get baseline values with proper defaults
      const baselinePrice = parseFloat(alert.baselinePrice) || 0;
      const baselineVolume = parseFloat(alert.baselineVolume) || 0;
      const baselineTimestamp = alert.baselineTimestamp || new Date();
      const livePrice = parseFloat(priceData.price) || 0;

      // Calculate change from baseline with proper NaN handling
      let changeFromBaseline = 0;
      let changeFromBaselinePercent = 0;

      if (baselinePrice > 0 && livePrice > 0) {
        changeFromBaseline = livePrice - baselinePrice;
        changeFromBaselinePercent = (changeFromBaseline / baselinePrice) * 100;

        // Handle NaN or Infinity cases
        if (!isFinite(changeFromBaseline)) changeFromBaseline = 0;
        if (!isFinite(changeFromBaselinePercent)) changeFromBaselinePercent = 0;
      }

      // Determine direction based on price change
      const direction =
        changeFromBaselinePercent > 0
          ? "increase"
          : changeFromBaselinePercent < 0
          ? "decrease"
          : "both";

      // Create alert history entry
      const alertHistory = {
        alertId: alert._id,
        userId: alert.userId,
        symbol: alert.symbol,
        alertConditions: {
          ...alert.conditions,
          changePercent: {
            ...alert.conditions.changePercent,
            direction: direction,
          },
        },
        triggerData: {
          price: parseFloat(priceData.price) || 0,
          priceChange: parseFloat(priceData.priceChange) || 0,
          priceChangePercent: parseFloat(priceData.priceChangePercent) || 0,
          volume24h: parseFloat(priceData.volume || priceData.volume24h) || 0,
          high: parseFloat(priceData.high) || 0,
          low: parseFloat(priceData.low) || 0,
          open: parseFloat(priceData.open) || 0,
          close: parseFloat(priceData.close) || 0,
          timestamp: priceData.timestamp || Date.now(),
        },
        baselineData: {
          baselinePrice: baselinePrice,
          baselineVolume: baselineVolume,
          baselineTimestamp: baselineTimestamp,
          changeFromBaseline: changeFromBaseline,
          changeFromBaselinePercent: changeFromBaselinePercent,
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

      // Save alert history (only once per trigger)
      let savedHistory = null;
      try {
        savedHistory = await AlertHistoryService.createAlertHistory(
          alertHistory
        );
        if (!savedHistory || !savedHistory._id) {
          console.error(
            `❌ Failed to save alert history for ${alert.symbol}, savedHistory is invalid`
          );
          return false;
        }
        console.log(`✅ Alert history saved successfully: ${savedHistory._id}`);
        console.log(`✅ Alert history details:`, {
          id: savedHistory._id,
          symbol: savedHistory.symbol,
          price: savedHistory.triggerData.price,
          triggeredAt: savedHistory.triggeredAt,
        });

        // Mark as processed AFTER successful save to prevent duplicates
        this.processedAlerts.add(alertKey);
        console.log(
          `✅ Alert ${alert._id} marked as processed after history save`
        );
      } catch (historyError) {
        console.error(
          `❌ Error saving alert history for ${alert.symbol}:`,
          historyError
        );
        console.error(`❌ History error details:`, historyError.message);
        console.error(`❌ History error stack:`, historyError.stack);
        // Don't mark as processed if save failed - allow retry
        return false;
      }

      // Update alert lock if alert count is set
      let updatedConditions = null;
      if (
        alert.conditions.alertCount &&
        alert.conditions.alertCount.timeframe
      ) {
        updatedConditions = updateAlertLock(alert);

        // Update alert conditions with new lock time and new baseline
        await Alert.findByIdAndUpdate(alert._id, {
          conditions: updatedConditions,
          // Update last triggered info but keep alert active
          lastTriggeredAt: new Date(),
          lastTriggeredPrice: priceData.price,
          lastTriggeredVolume: priceData.volume,
          // Update baseline to current price to prevent re-triggering on same price
          baselinePrice: priceData.price,
          baselineVolume: priceData.volume,
          baselineTimestamp: new Date(),
        });

        console.log(
          `🔒 Alert ${alert._id} for ${alert.symbol} locked until ${updatedConditions.alertCount.lockUntil}`
        );
        console.log(
          `⏰ Next trigger allowed after: ${updatedConditions.alertCount.lockUntil}`
        );
        console.log(`📊 Baseline updated to current price: ${priceData.price}`);
      } else {
        // Update last triggered info and baseline but keep alert active
        await Alert.findByIdAndUpdate(alert._id, {
          lastTriggeredAt: new Date(),
          lastTriggeredPrice: priceData.price,
          lastTriggeredVolume: priceData.volume,
          // Update baseline to current price to prevent re-triggering on same price
          baselinePrice: priceData.price,
          baselineVolume: priceData.volume,
          baselineTimestamp: new Date(),
        });

        console.log(
          `✅ Alert ${alert._id} for ${alert.symbol} updated (no lock period)`
        );
        console.log(`📊 Baseline updated to current price: ${priceData.price}`);
      }

      // CRITICAL: Update the in-memory alert with new baseline
      alert.baselinePrice = priceData.price;
      alert.baselineVolume = priceData.volume;
      alert.baselineTimestamp = new Date();
      alert.lastTriggeredAt = new Date();
      alert.lastTriggeredPrice = priceData.price;
      alert.lastTriggeredVolume = priceData.volume;
      if (updatedConditions) {
        alert.conditions = updatedConditions;
      }
      console.log(
        `🔄 In-memory alert updated with new baseline: ${priceData.price}`
      );

      // Update the alert in activeAlerts map
      const alertsForSymbol = this.activeAlerts.get(alert.symbol);
      if (alertsForSymbol) {
        const alertIndex = alertsForSymbol.findIndex(
          (a) => a._id.toString() === alert._id.toString()
        );
        if (alertIndex !== -1) {
          alertsForSymbol[alertIndex] = alert;
          console.log(
            `🔄 Updated alert in activeAlerts map for ${alert.symbol}`
          );
        }
      }

      // Clean up old processed alerts (keep only last 60 seconds)
      const currentTime = Math.floor(Date.now() / 1000);
      for (const key of this.processedAlerts) {
        const [, timestamp] = key.split("_");
        if (timestamp && currentTime - parseInt(timestamp) > 60) {
          this.processedAlerts.delete(key);
        }
      }

      // Send real-time notification using saved alert history (with _id)
      // Fire and forget - don't block alert processing for notifications
      if (savedHistory) {
        this.sendRealTimeNotification(alert, priceData, savedHistory).catch(
          (error) => {
            console.error(
              `❌ Error sending notification for ${alert.symbol} (non-blocking):`,
              error.message
            );
          }
        );
      } else {
        console.error(
          `❌ Cannot send notification: savedHistory is null for ${alert.symbol}`
        );
      }

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

    if (conditions.openInterest) {
      parts.push(
        `Open Interest: ${conditions.openInterest.direction}${
          conditions.openInterest.percentage
            ? ` ${conditions.openInterest.percentage}%`
            : ""
        }`
      );
    }

    return parts.join(", ");
  }

  async sendRealTimeNotification(alert, priceData, alertHistory) {
    try {
      console.log(
        `📢 sendRealTimeNotification called for ${alert.symbol}, alertHistory._id: ${alertHistory._id}`
      );

      // Get user info for email and telegram
      const user = await User.findById(alert.userId)
        .select("email telegramChatId notificationPreferences")
        .lean();

      if (!user) {
        console.error(`❌ User not found: ${alert.userId}`);
        return;
      }

      // Prepare notification data for SSE stream with complete alert history info
      const notification = {
        type: "alert_triggered",
        _id: alertHistory._id,
        id: alertHistory._id,
        symbol: alert.symbol,
        price: priceData.price,
        priceChange: priceData.priceChange,
        priceChangePercent: priceData.priceChangePercent,
        volume: priceData.volume || priceData.volume24h,
        high: priceData.high,
        low: priceData.low,
        open: priceData.open,
        close: priceData.close,
        conditions: alertHistory.conditions,
        triggeredAt: alertHistory.triggeredAt,
        alertId: alert._id,
        userId: alert.userId,
        // Add detailed alert info for frontend display
        targetValue:
          alert.alertConditions?.changePercent?.percentage ||
          alert.conditions?.changePercent?.percentage,
        actualValue: priceData.priceChangePercent,
        direction:
          (alert.alertConditions?.changePercent?.direction ||
            alert.conditions?.changePercent?.direction) === "increase"
            ? "increase"
            : "decrease",
        timeframe:
          alert.alertConditions?.changePercent?.timeframe ||
          alert.conditions?.changePercent?.timeframe ||
          "5MIN",
        baselinePrice: alertHistory.baselineData?.baselinePrice,
        changeFromBaselinePercent:
          alertHistory.baselineData?.changeFromBaselinePercent,
        // Add alert history data for complete display
        alertConditions: alert.alertConditions || alert.conditions,
        triggerData: {
          price: priceData.price,
          priceChangePercent: priceData.priceChangePercent,
          volume24h: priceData.volume || priceData.volume24h,
        },
        baselineData: alertHistory.baselineData,
      };

      console.log(`📢 Sending real-time notification for ${alert.symbol}:`, {
        userId: alert.userId,
        symbol: notification.symbol,
        price: notification.price,
        targetValue: notification.targetValue,
        actualValue: notification.actualValue,
      });

      // Send notification via SSE stream
      await NotificationService.sendNotification(alert.userId, notification);
      console.log(
        `✅ Real-time notification sent successfully for ${alert.symbol}`
      );

      // CRITICAL FIX: Also publish to Redis for real-time alerts
      try {
        const Redis = (await import("ioredis")).default;
        const redis = new Redis({
          host: process.env.REDIS_HOST || "localhost",
          port: process.env.REDIS_PORT || 6379,
          lazyConnect: true,
          retryDelayOnClusterDown: 300,
          maxRetriesPerRequest: 3,
        });

        const alertData = {
          type: "alert_triggered",
          alertId: alert._id,
          historyId: alertHistory._id,
          userId: alert.userId,
          symbol: alert.symbol,
          triggeredAt: new Date(),
          triggeredPrice: parseFloat(priceData.price),
          triggeredVolume: parseFloat(priceData.volume || priceData.volume24h),
          triggeredChange: parseFloat(priceData.priceChangePercent),
          conditions: alert.conditions,
          notificationSettings: alert.notificationSettings,
          // Add frontend display data
          targetValue: notification.targetValue,
          actualValue: notification.actualValue,
          direction: notification.direction,
          timeframe: notification.timeframe,
          baselinePrice: notification.baselinePrice,
          changeFromBaselinePercent: notification.changeFromBaselinePercent,
        };

        // Publish to alert triggers channel for real-time updates
        await redis.publish("alert:triggers", JSON.stringify(alertData));
        console.log(
          `🚨 Alert published to Redis for ${alert.symbol}:`,
          alertData
        );

        // Also publish to notifications channel for header badge updates
        await redis.publish(
          "notifications:alerts",
          JSON.stringify({
            type: "new_alert",
            userId: alert.userId,
            symbol: alert.symbol,
            timestamp: new Date(),
            alertId: alert._id,
          })
        );
        console.log(
          `📢 Alert notification published to Redis for user ${alert.userId}`
        );

        await redis.quit();
      } catch (redisError) {
        console.error("❌ Error publishing alert to Redis:", redisError);
        // Don't fail the whole process if Redis fails
      }

      // Prepare formatted alert data for Email & Telegram
      const alertData = {
        symbol: alert.symbol,
        targetValue: alert.conditions?.changePercent?.percentage || "N/A",
        actualValue: priceData.priceChangePercent || 0,
        direction:
          alert.conditions?.changePercent?.direction === "increase"
            ? "Increase"
            : alert.conditions?.changePercent?.direction === "decrease"
            ? "Decrease"
            : "Increase",
        timeframe: alert.conditions?.changePercent?.timeframe || "5MIN",
        triggeredPrice: priceData.price,
        baselinePrice: alertHistory.baselineData?.baselinePrice,
        changeFromBaselinePercent:
          alertHistory.baselineData?.changeFromBaselinePercent,
        volume: priceData.volume || priceData.volume24h,
        triggeredAt: alertHistory.triggeredAt,
      };

      // Debug: Log the alert data being sent to email
      console.log(`📧 Email Alert Data for ${alert.symbol}:`, {
        targetValue: alertData.targetValue,
        actualValue: alertData.actualValue,
        direction: alertData.direction,
        timeframe: alertData.timeframe,
        triggeredPrice: alertData.triggeredPrice,
        baselinePrice: alertData.baselinePrice,
        changeFromBaselinePercent: alertData.changeFromBaselinePercent,
      });

      // Send Email notification if enabled
      if (user.notificationPreferences?.email !== false && user.email) {
        console.log(`📧 Sending email to ${user.email}...`);
        const emailSent = await EmailService.sendAlertEmail(
          user.email,
          alertData
        );
        if (emailSent) {
          console.log(`✅ Email sent successfully to ${user.email}`);
        } else {
          console.error(`❌ Failed to send email to ${user.email}`);
        }
      }

      // Check if Telegram notification should be sent
      // Since alertHistory was just saved, it should be fresh and notificationSent should not be set
      // We'll use atomic update in the sending logic to prevent duplicates
      const shouldSendTelegram =
        user.notificationPreferences?.telegram &&
        user.telegramChatId &&
        alertHistory._id;

      console.log(
        `🔍 Checking Telegram notification for alertHistory ${alertHistory._id}:`,
        {
          telegramEnabled: user.notificationPreferences?.telegram,
          hasTelegramChatId: !!user.telegramChatId,
          hasAlertHistoryId: !!alertHistory._id,
          shouldSendTelegram: shouldSendTelegram,
          notificationSent: alertHistory.notificationSent,
        }
      );

      // Send Telegram notification if enabled
      // Atomic update will prevent duplicates if multiple alerts try to send simultaneously
      if (shouldSendTelegram) {
        // First, atomically check if notification was already sent
        // This prevents multiple parallel attempts from sending the same notification
        const checkResult = await AlertHistory.findOne({
          _id: alertHistory._id,
          "notificationSent.telegram": { $ne: true }, // Only if not already sent
        }).lean();

        if (!checkResult) {
          console.log(
            `⚠️ Alert history ${alertHistory._id} already has Telegram notification sent, skipping`
          );
        } else {
          console.log(
            `📱 Sending Telegram message to ${user.telegramChatId} for alert history ${alertHistory._id}...`
          );

          // Capture chart screenshot
          let chartScreenshot = null;
          try {
            console.log(
              `[${alert.symbol}] Capturing TradingView chart screenshot...`
            );
            const timeframe =
              alertData.timeframe ||
              alert.conditions?.changePercent?.timeframe ||
              "5m";
            chartScreenshot = await ChartScreenshotService.captureChart(
              alert.symbol,
              timeframe
            );
            console.log(`[${alert.symbol}] Screenshot captured successfully`);
          } catch (screenshotError) {
            console.error(
              `[${alert.symbol}] Failed to capture chart screenshot:`,
              screenshotError.message
            );
            console.log(`[${alert.symbol}] Will send text-only alert`);
          }

          // Retry logic: try up to 3 times with minimal delay (max 3 seconds total)
          let telegramSent = false;
          let retryCount = 0;
          const maxRetries = 3;

          while (!telegramSent && retryCount < maxRetries) {
            try {
              // Only add delay for retries, not first attempt (immediate send)
              if (retryCount > 0) {
                // Fixed 1 second delay per retry (max 2 retries = 2 seconds total, within 3 second limit)
                const delay = 1100; // 1 second per retry
                console.log(
                  `🔄 Retry ${retryCount}/${maxRetries - 1} after ${delay}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
              }

              // Send with photo if screenshot was captured, otherwise send text only
              if (chartScreenshot) {
                telegramSent = await TelegramService.sendPhotoAlert(
                  user.telegramChatId,
                  chartScreenshot,
                  alertData
                );
                console.log(`[${alert.symbol}] Telegram alert sent with chart`);
              } else {
                telegramSent = await TelegramService.sendAlertMessage(
                  user.telegramChatId,
                  alertData
                );
                console.log(
                  `[${alert.symbol}] Telegram alert sent (text only)`
                );
              }

              if (telegramSent) {
                console.log(
                  `✅ Telegram message sent successfully to ${user.telegramChatId}`
                );
                // Mark as sent in database using atomic update (non-blocking)
                // Fire and forget - don't wait for DB update to complete
                AlertHistory.findOneAndUpdate(
                  {
                    _id: alertHistory._id,
                    "notificationSent.telegram": { $ne: true }, // Only update if not already true
                  },
                  {
                    $set: { "notificationSent.telegram": true },
                  },
                  { new: true }
                )
                  .then((updateResult) => {
                    if (updateResult) {
                      console.log(
                        `✅ Alert history ${alertHistory._id} marked as Telegram sent`
                      );
                    } else {
                      console.log(
                        `⚠️ Alert history ${alertHistory._id} was already marked as Telegram sent (atomic check)`
                      );
                    }
                  })
                  .catch((error) => {
                    console.error(
                      `❌ Error marking alert history ${alertHistory._id} as sent:`,
                      error.message
                    );
                  });
              } else {
                retryCount++;
                if (retryCount < maxRetries) {
                  console.log(
                    `⚠️ Telegram send failed, will retry (${retryCount}/${
                      maxRetries - 1
                    })`
                  );
                }
              }
            } catch (error) {
              retryCount++;
              console.error(
                `❌ Error sending Telegram message (attempt ${retryCount}/${maxRetries}):`,
                error.message
              );
              if (retryCount >= maxRetries) {
                console.error(
                  `❌ Failed to send Telegram message after ${maxRetries} attempts`
                );
              }
            }
          } // End of while loop
        } // End of else block for checkResult
      } else {
        // Telegram notification was not sent - log the reason
        console.log(
          `⚠️ Telegram notification skipped for alert history ${alertHistory._id}:`,
          {
            telegramEnabled: user.notificationPreferences?.telegram,
            hasTelegramChatId: !!user.telegramChatId,
            hasAlertHistoryId: !!alertHistory._id,
            reason: !user.notificationPreferences?.telegram
              ? "Telegram disabled in preferences"
              : !user.telegramChatId
              ? "No Telegram chat ID"
              : !alertHistory._id
              ? "No alert history ID"
              : "Already sent or check failed",
          }
        );
      }

      console.log(`📢 Notification: ${alert.symbol} alert triggered!`);
      console.log(`   Price: $${priceData.price}`);
      console.log(`   Change: ${priceData.priceChangePercent}%`);
      console.log(`   Volume: ${priceData.volume || priceData.volume24h}`);
      console.log(`   Conditions: ${alertHistory.conditions}`);
    } catch (error) {
      console.error("❌ Error sending real-time notification:", error);
    }
  }

  // Calculate RSI from Binance klines data
  async calculateRSI(symbol, timeframe, period = 14) {
    try {
      const binanceInterval = this.getBinanceInterval(timeframe);
      // Fetch enough candles for RSI calculation (period + 1 for safety)
      const limit = period + 5;

      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
      );

      if (!response.ok) {
        console.warn(
          `⚠️ Failed to fetch klines for RSI calculation: ${response.status}`
        );
        return null;
      }

      const klines = await response.json();

      if (klines.length < period + 1) {
        console.warn(
          `⚠️ Not enough data for RSI calculation: need ${period + 1}, got ${
            klines.length
          }`
        );
        return null;
      }

      // Extract close prices
      const closes = klines.map((kline) => parseFloat(kline[4]));

      // Calculate price changes
      const changes = [];
      for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
      }

      // Separate gains and losses
      const gains = changes.map((change) => (change > 0 ? change : 0));
      const losses = changes.map((change) =>
        change < 0 ? Math.abs(change) : 0
      );

      // Calculate initial average gain and loss (first period)
      let avgGain = 0;
      let avgLoss = 0;

      for (let i = 0; i < period; i++) {
        avgGain += gains[i];
        avgLoss += losses[i];
      }

      avgGain = avgGain / period;
      avgLoss = avgLoss / period;

      // Calculate RSI using Wilder's smoothing method
      for (let i = period; i < changes.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      }

      // Avoid division by zero
      if (avgLoss === 0) {
        return avgGain > 0 ? 100 : 50;
      }

      const rs = avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);

      console.log(
        `📈 RSI calculated for ${symbol} (${timeframe}): ${rsi.toFixed(
          2
        )} (Period: ${period})`
      );

      return rsi;
    } catch (error) {
      console.error(
        `❌ Error calculating RSI for ${symbol} (${timeframe}):`,
        error.message
      );
      return null;
    }
  }

  // Get RSI value for a symbol and timeframe (with caching)
  async getRSI(symbol, timeframe, period = 14) {
    const key = `${symbol}_${timeframe}_${period}`;
    const rsiValue = await this.calculateRSI(symbol, timeframe, period);

    if (rsiValue !== null) {
      // Store previous RSI value before updating
      const existing = this.rsiData.get(key);
      if (existing) {
        existing.previous = existing.current;
      }

      // Update current RSI
      this.rsiData.set(key, {
        current: rsiValue,
        previous: existing?.previous || rsiValue,
        timestamp: Date.now(),
      });
    }

    return this.rsiData.get(key);
  }

  // Technical analysis helper methods
  async evaluateCandleConditions(candleConditions, priceData, symbol = null) {
    // Get current live price for timeframe confirmation
    const currentPrice = priceData.price || priceData.close;
    const { open, high, low, close } = priceData;

    // Validate OHLC data
    if (!open || !high || !low || !close) {
      console.log("⚠️ Missing OHLC data for candle evaluation");
      return true; // Skip if data missing
    }

    const condition = candleConditions.condition;
    const timeframes = candleConditions.timeframes || [];
    const range = high - low;

    console.log(`🕯️ Candle Evaluation: ${condition}`);
    console.log(`   OHLC: O=${open}, H=${high}, L=${low}, C=${close}`);
    console.log(`   Range: ${range.toFixed(6)} (High ${high} - Low ${low})`);

    switch (condition) {
      case "CANDLE_ABOVE_OPEN":
        // Bullish candle: Close > Open
        // For multiple timeframes: ALL selected timeframes must have Close > Open
        let allTimeframesAboveOpen = true;

        if (timeframes.length > 0 && symbol) {
          // Check ALL selected timeframes - ALL must pass
          let verifiedTimeframes = 0;
          for (const timeframe of timeframes) {
            let candle = this.getCandleData(symbol, timeframe);

            // If candle data is missing or null, fetch from Binance API
            if (!candle || candle.open === null || candle.close === null) {
              console.log(
                `   ⚠️ Timeframe ${timeframe}: Local candle data missing, fetching from Binance...`
              );
              const binanceCandle = await this.fetchCandleFromBinance(
                symbol,
                timeframe
              );
              if (binanceCandle) {
                // Update local candle data with Binance data
                candle = this.getCandleData(symbol, timeframe);
                candle.open = binanceCandle.open;
                candle.high = binanceCandle.high;
                candle.low = binanceCandle.low;
                candle.close = binanceCandle.close;
                candle.volume = binanceCandle.volume;
                candle.startTime = binanceCandle.startTime;
                candle.endTime = binanceCandle.endTime;
                candle.isComplete = binanceCandle.isComplete;
                console.log(
                  `   ✅ Fetched candle from Binance for ${timeframe}: O=${candle.open}, C=${candle.close}`
                );
              }
            }

            if (candle && candle.open !== null && candle.close !== null) {
              const tfAboveOpen = candle.close > candle.open;
              verifiedTimeframes++;
              console.log(
                `   Timeframe ${timeframe}: Close ${candle.close} > Open ${candle.open}? ${tfAboveOpen}`
              );
              if (!tfAboveOpen) {
                allTimeframesAboveOpen = false;
                console.log(
                  `   ❌ Timeframe ${timeframe} FAILED: Close ${candle.close} <= Open ${candle.open}`
                );
                break; // One timeframe failed, condition invalid
              }
            } else {
              console.log(
                `   ⚠️ Timeframe ${timeframe}: Missing candle data (open/close), cannot verify`
              );
              // If candle data is missing for a required timeframe, we can't verify
              // This means the condition cannot be confirmed, so fail it
              allTimeframesAboveOpen = false;
              break;
            }
          }

          console.log(
            `   Candle Above Open check (multi-timeframe): ${allTimeframesAboveOpen} (${verifiedTimeframes}/${timeframes.length} timeframes verified, ALL must pass)`
          );
          return allTimeframesAboveOpen;
        } else {
          // Fallback: use current priceData if no timeframes specified
          const isAboveOpen = close > open;
          console.log(
            `   Candle Above Open check: ${isAboveOpen} (Close ${close} > Open ${open})`
          );
          return isAboveOpen;
        }

      case "HAMMER":
        // Hammer: Bullish reversal pattern
        // Conditions:
        // 1. Open AND Close both in upper 30% of range (both >= 70% from low)
        // 2. Current price (close) should be above open for confirmation
        // Example: High=100, Low=80, Range=20, Upper 30% = 6, Top zone = 94
        // Open=98 and Close=96 both >= 94 → Hammer ✅
        if (range === 0) {
          console.log(`   Hammer check: Range is 0, skipping`);
          return false;
        }

        // Calculate positions from low
        const openPositionFromLow = (open - low) / range;
        const closePositionFromLow = (close - low) / range;

        // Upper 30% zone: 70% and above (100% - 30% = 70%)
        const upper30PercentThreshold = 0.7;

        // Check: Both open and close in upper 30%
        const bothInUpper30 =
          openPositionFromLow >= upper30PercentThreshold &&
          closePositionFromLow >= upper30PercentThreshold;

        // Confirmation: Current live price above candle open (timeframe confirmation)
        // For multiple timeframes: check if current price > open for ALL selected timeframes
        let timeframeConfirmation = true;

        if (timeframes.length > 0 && symbol) {
          // Check confirmation for each selected timeframe
          for (const timeframe of timeframes) {
            let candle = this.getCandleData(symbol, timeframe);

            // If candle data is missing or null, fetch from Binance API
            if (!candle || candle.open === null) {
              console.log(
                `   ⚠️ Timeframe ${timeframe}: Local candle data missing, fetching from Binance...`
              );
              const binanceCandle = await this.fetchCandleFromBinance(
                symbol,
                timeframe
              );
              if (binanceCandle) {
                // Update local candle data with Binance data
                candle = this.getCandleData(symbol, timeframe);
                candle.open = binanceCandle.open;
                candle.high = binanceCandle.high;
                candle.low = binanceCandle.low;
                candle.close = binanceCandle.close;
                candle.volume = binanceCandle.volume;
                candle.startTime = binanceCandle.startTime;
                candle.endTime = binanceCandle.endTime;
                candle.isComplete = binanceCandle.isComplete;
                console.log(
                  `   ✅ Fetched candle from Binance for ${timeframe}: O=${candle.open}, C=${candle.close}`
                );
              }
            }

            if (candle && candle.open) {
              const tfConfirmed = currentPrice > candle.open;
              console.log(
                `   Timeframe ${timeframe} confirmation: ${tfConfirmed} (Current ${currentPrice} > Open ${candle.open})`
              );
              if (!tfConfirmed) {
                timeframeConfirmation = false;
                break; // One timeframe failed, pattern invalid
              }
            }
          }
        } else {
          // Fallback: use current priceData open for confirmation
          timeframeConfirmation = currentPrice > open;
        }

        const isHammer = bothInUpper30 && timeframeConfirmation;

        console.log(`   Hammer check: ${isHammer}`);
        console.log(
          `   Open position: ${(openPositionFromLow * 100).toFixed(
            2
          )}% (${open}), Close position: ${(closePositionFromLow * 100).toFixed(
            2
          )}% (${close})`
        );
        console.log(
          `   Both in upper 30%: ${bothInUpper30} (Open >= 70%, Close >= 70%)`
        );
        console.log(
          `   Timeframe confirmation: ${timeframeConfirmation} (Current Price ${currentPrice} > Open for all selected timeframes)`
        );
        console.log(
          `   Range: ${range}, Upper 30% zone starts at: ${(
            low +
            range * 0.7
          ).toFixed(2)}`
        );

        return isHammer;

      case "INVERTED_HAMMER":
        // Inverted Hammer: Bearish reversal pattern
        // Conditions:
        // 1. Open AND Close both in lower 30% of range (both <= 30% from low)
        // Example: High=120, Low=100, Range=20, Lower 30% = 6, Bottom zone = 106
        // Open=102 and Close=104 both <= 106 → Inverted Hammer ✅
        if (range === 0) {
          console.log(`   Inverted Hammer check: Range is 0, skipping`);
          return false;
        }

        // Calculate positions from low
        const openPositionFromLowInv = (open - low) / range;
        const closePositionFromLowInv = (close - low) / range;

        // Lower 30% zone: 30% and below
        const lower30PercentThreshold = 0.3;

        // Check: Both open and close in lower 30%
        const bothInLower30 =
          openPositionFromLowInv <= lower30PercentThreshold &&
          closePositionFromLowInv <= lower30PercentThreshold;

        // Confirmation: Current live price above candle open (timeframe confirmation)
        // For multiple timeframes: check if current price > open for ALL selected timeframes
        let timeframeConfirmationInv = true;

        if (timeframes.length > 0 && symbol) {
          // Check confirmation for each selected timeframe
          for (const timeframe of timeframes) {
            let candle = this.getCandleData(symbol, timeframe);

            // If candle data is missing or null, fetch from Binance API
            if (!candle || candle.open === null) {
              console.log(
                `   ⚠️ Timeframe ${timeframe}: Local candle data missing, fetching from Binance...`
              );
              const binanceCandle = await this.fetchCandleFromBinance(
                symbol,
                timeframe
              );
              if (binanceCandle) {
                // Update local candle data with Binance data
                candle = this.getCandleData(symbol, timeframe);
                candle.open = binanceCandle.open;
                candle.high = binanceCandle.high;
                candle.low = binanceCandle.low;
                candle.close = binanceCandle.close;
                candle.volume = binanceCandle.volume;
                candle.startTime = binanceCandle.startTime;
                candle.endTime = binanceCandle.endTime;
                candle.isComplete = binanceCandle.isComplete;
                console.log(
                  `   ✅ Fetched candle from Binance for ${timeframe}: O=${candle.open}, C=${candle.close}`
                );
              }
            }

            if (candle && candle.open) {
              const tfConfirmed = currentPrice > candle.open;
              console.log(
                `   Timeframe ${timeframe} confirmation: ${tfConfirmed} (Current ${currentPrice} > Open ${candle.open})`
              );
              if (!tfConfirmed) {
                timeframeConfirmationInv = false;
                break; // One timeframe failed, pattern invalid
              }
            }
          }
        } else {
          // Fallback: use current priceData open for confirmation
          timeframeConfirmationInv = currentPrice > open;
        }

        const isInvertedHammer = bothInLower30 && timeframeConfirmationInv;

        console.log(`   Inverted Hammer check: ${isInvertedHammer}`);
        console.log(
          `   Open position: ${(openPositionFromLowInv * 100).toFixed(
            2
          )}% (${open}), Close position: ${(
            closePositionFromLowInv * 100
          ).toFixed(2)}% (${close})`
        );
        console.log(
          `   Both in lower 30%: ${bothInLower30} (Open <= 30%, Close <= 30%)`
        );
        console.log(
          `   Timeframe confirmation: ${timeframeConfirmationInv} (Current Price ${currentPrice} > Open for all selected timeframes)`
        );
        console.log(
          `   Range: ${range}, Lower 30% zone ends at: ${(
            low +
            range * 0.3
          ).toFixed(2)}`
        );

        return isInvertedHammer;

      default:
        console.log(`   Unknown candle condition: ${condition}`);
        return true;
    }
  }

  async evaluateRSIConditions(rsiConditions, priceData, symbol = null) {
    const { condition, level, period, timeframes } = rsiConditions;
    const targetLevel = parseFloat(level) || 50;
    const rsiPeriod = parseInt(period) || 14;

    console.log(
      `📈 RSI Evaluation: ${condition} ${targetLevel} (Period: ${rsiPeriod})`
    );

    // If timeframes are specified, check ALL timeframes
    if (timeframes && timeframes.length > 0 && symbol) {
      let allTimeframesPassed = true;
      let verifiedTimeframes = 0;

      for (const timeframe of timeframes) {
        console.log(`   Checking timeframe: ${timeframe}`);

        // Get RSI value for this timeframe
        const rsiData = await this.getRSI(symbol, timeframe, rsiPeriod);

        if (!rsiData || rsiData.current === null) {
          console.log(
            `   ⚠️ Timeframe ${timeframe}: RSI data not available, cannot verify`
          );
          allTimeframesPassed = false;
          break;
        }

        const currentRSI = rsiData.current;
        const previousRSI = rsiData.previous || currentRSI;
        verifiedTimeframes++;

        console.log(
          `   Timeframe ${timeframe}: Current RSI=${currentRSI.toFixed(
            2
          )}, Previous RSI=${previousRSI.toFixed(2)}`
        );

        let timeframePassed = false;

        switch (condition) {
          case "ABOVE":
            timeframePassed = currentRSI > targetLevel;
            console.log(
              `   Timeframe ${timeframe}: RSI ${currentRSI.toFixed(
                2
              )} > ${targetLevel}? ${timeframePassed}`
            );
            break;

          case "BELOW":
            timeframePassed = currentRSI < targetLevel;
            console.log(
              `   Timeframe ${timeframe}: RSI ${currentRSI.toFixed(
                2
              )} < ${targetLevel}? ${timeframePassed}`
            );
            break;

          case "CROSSING_UP":
            // Previous RSI was below or equal, now above
            timeframePassed =
              previousRSI <= targetLevel && currentRSI > targetLevel;
            console.log(
              `   Timeframe ${timeframe}: Crossing Up check - Previous ${previousRSI.toFixed(
                2
              )} <= ${targetLevel} AND Current ${currentRSI.toFixed(
                2
              )} > ${targetLevel}? ${timeframePassed}`
            );
            break;

          case "CROSSING_DOWN":
            // Previous RSI was above or equal, now below
            timeframePassed =
              previousRSI >= targetLevel && currentRSI < targetLevel;
            console.log(
              `   Timeframe ${timeframe}: Crossing Down check - Previous ${previousRSI.toFixed(
                2
              )} >= ${targetLevel} AND Current ${currentRSI.toFixed(
                2
              )} < ${targetLevel}? ${timeframePassed}`
            );
            break;

          default:
            console.log(`   Unknown RSI condition: ${condition}`);
            timeframePassed = false;
        }

        if (!timeframePassed) {
          allTimeframesPassed = false;
          console.log(
            `   ❌ Timeframe ${timeframe} FAILED: Condition ${condition} not met`
          );
          break; // One timeframe failed, condition invalid
        } else {
          console.log(
            `   ✅ Timeframe ${timeframe} PASSED: Condition ${condition} met`
          );
        }
      }

      console.log(
        `   RSI check (multi-timeframe): ${allTimeframesPassed} (${verifiedTimeframes}/${timeframes.length} timeframes verified, ALL must pass)`
      );
      return allTimeframesPassed;
    } else {
      // Fallback: use single RSI calculation if no timeframes specified
      // This should not happen in normal flow, but keeping for compatibility
      console.log(`   ⚠️ No timeframes specified, using fallback calculation`);
      return true; // Skip if no timeframes
    }
  }

  async evaluateVolumeConditions(
    volumeConditions,
    priceData,
    symbol = null,
    alert = null
  ) {
    const { condition, percentage, timeframes } = volumeConditions;
    const requiredPercentage = parseFloat(percentage) || 0;

    console.log(
      `📉 Volume Evaluation: ${condition}${
        percentage ? ` by ${percentage}%` : ""
      }`
    );

    // If timeframes are specified, check ALL timeframes
    if (timeframes && timeframes.length > 0 && symbol) {
      let allTimeframesPassed = true;
      let verifiedTimeframes = 0;

      for (const timeframe of timeframes) {
        console.log(`   Checking timeframe: ${timeframe}`);

        // Get candle data for this timeframe to get volume
        let candle = this.getCandleData(symbol, timeframe);

        // If candle data is missing, fetch from Binance
        if (!candle || candle.volume === null || candle.volume === 0) {
          console.log(
            `   ⚠️ Timeframe ${timeframe}: Candle volume data missing, fetching from Binance...`
          );
          const binanceCandle = await this.fetchCandleFromBinance(
            symbol,
            timeframe
          );
          if (binanceCandle) {
            candle = this.getCandleData(symbol, timeframe);
            candle.volume = binanceCandle.volume;
            candle.open = binanceCandle.open;
            candle.close = binanceCandle.close;
            console.log(
              `   ✅ Fetched candle volume from Binance for ${timeframe}: ${binanceCandle.volume.toLocaleString()}`
            );
          }
        }

        if (!candle || !candle.volume || candle.volume === 0) {
          console.log(
            `   ⚠️ Timeframe ${timeframe}: Volume data not available, cannot verify`
          );
          allTimeframesPassed = false;
          break;
        }

        const currentVolume = candle.volume;
        const baselineVolume = alert ? alert.baselineVolume || 0 : 0;
        verifiedTimeframes++;

        console.log(
          `   Timeframe ${timeframe}: Current Volume=${currentVolume.toLocaleString()}, Baseline Volume=${baselineVolume.toLocaleString()}`
        );

        let timeframePassed = false;

        switch (condition) {
          case "INCREASING":
            if (baselineVolume > 0) {
              const volumeChange =
                ((currentVolume - baselineVolume) / baselineVolume) * 100;
              timeframePassed = volumeChange >= requiredPercentage;
              console.log(
                `   Timeframe ${timeframe}: Volume INCREASING check - Change ${volumeChange.toFixed(
                  2
                )}% >= ${requiredPercentage}%? ${timeframePassed}`
              );
            } else {
              console.log(
                `   ⚠️ Timeframe ${timeframe}: No baseline volume, skipping INCREASING check`
              );
              timeframePassed = true; // Skip if no baseline
            }
            break;

          case "DECREASING":
            if (baselineVolume > 0) {
              const volumeChange =
                ((currentVolume - baselineVolume) / baselineVolume) * 100;
              timeframePassed = volumeChange <= -requiredPercentage;
              console.log(
                `   Timeframe ${timeframe}: Volume DECREASING check - Change ${volumeChange.toFixed(
                  2
                )}% <= -${requiredPercentage}%? ${timeframePassed}`
              );
            } else {
              console.log(
                `   ⚠️ Timeframe ${timeframe}: No baseline volume, skipping DECREASING check`
              );
              timeframePassed = true; // Skip if no baseline
            }
            break;

          case "ABOVE":
            timeframePassed = currentVolume > requiredPercentage;
            console.log(
              `   Timeframe ${timeframe}: Volume ABOVE check - ${currentVolume.toLocaleString()} > ${requiredPercentage.toLocaleString()}? ${timeframePassed}`
            );
            break;

          case "BELOW":
            timeframePassed = currentVolume < requiredPercentage;
            console.log(
              `   Timeframe ${timeframe}: Volume BELOW check - ${currentVolume.toLocaleString()} < ${requiredPercentage.toLocaleString()}? ${timeframePassed}`
            );
            break;

          default:
            console.log(`   Unknown volume condition: ${condition}`);
            timeframePassed = false;
        }

        if (!timeframePassed) {
          allTimeframesPassed = false;
          console.log(
            `   ❌ Timeframe ${timeframe} FAILED: Volume condition ${condition} not met`
          );
          break; // One timeframe failed, condition invalid
        } else {
          console.log(
            `   ✅ Timeframe ${timeframe} PASSED: Volume condition ${condition} met`
          );
        }
      }

      console.log(
        `   Volume check (multi-timeframe): ${allTimeframesPassed} (${verifiedTimeframes}/${timeframes.length} timeframes verified, ALL must pass)`
      );
      return allTimeframesPassed;
    } else {
      // Fallback: use single volume check if no timeframes specified
      const currentVolume =
        parseFloat(priceData.volume || priceData.volume24h) || 0;

      if (currentVolume === 0) {
        console.log("⚠️ Volume data missing, skipping volume condition");
        return true;
      }

      console.log(`   Current Volume: ${currentVolume.toLocaleString()}`);

      switch (condition) {
        case "ABOVE":
          const isAbove = currentVolume > requiredPercentage;
          console.log(
            `   Above check: ${currentVolume.toLocaleString()} > ${requiredPercentage.toLocaleString()}? ${isAbove}`
          );
          return isAbove;

        case "BELOW":
          const isBelow = currentVolume < requiredPercentage;
          console.log(
            `   Below check: ${currentVolume.toLocaleString()} < ${requiredPercentage.toLocaleString()}? ${isBelow}`
          );
          return isBelow;

        default:
          console.log(
            `   ⚠️ No timeframes specified, using fallback calculation`
          );
          return true; // Skip if no timeframes
      }
    }
  }

  // Fetch Open Interest from Binance Futures API
  async fetchOpenInterest(symbol) {
    try {
      const futuresSymbol = symbol.toUpperCase();
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${futuresSymbol}`
      );

      if (!response.ok) {
        console.warn(
          `⚠️ Failed to fetch Open Interest for ${symbol}: ${response.status}`
        );
        return null;
      }

      const data = await response.json();
      const openInterest = parseFloat(data.openInterest || 0);

      console.log(
        `✅ Fetched Open Interest for ${symbol}: ${openInterest.toLocaleString()}`
      );

      return openInterest;
    } catch (error) {
      console.warn(
        `⚠️ Error fetching Open Interest for ${symbol}:`,
        error.message
      );
      return null;
    }
  }

  // Get or initialize Open Interest data for a symbol and timeframe
  async getOpenInterestData(symbol, timeframe, alert = null) {
    const key = `${symbol}_${timeframe}`;
    const currentTime = Date.now();
    const timeframeMs = this.getTimeframeMs(timeframe);

    // Fetch current Open Interest
    let currentOI = await this.fetchOpenInterest(symbol);

    if (currentOI === null) {
      // If fetch failed, try to use existing data
      const existing = this.openInterestData.get(key);
      if (existing) {
        return existing;
      }
      return null;
    }

    // Check if we need to update baseline (at timeframe intervals)
    const existing = this.openInterestData.get(key);

    if (!existing) {
      // Initialize with alert baseline or current OI
      const baseline = alert?.baselineOpenInterest || currentOI;
      this.openInterestData.set(key, {
        current: currentOI,
        baseline: baseline,
        timestamp: currentTime,
        lastUpdateTime: currentTime,
      });
      console.log(
        `📊 Initialized Open Interest for ${symbol} (${timeframe}): Current=${currentOI.toLocaleString()}, Baseline=${baseline.toLocaleString()}`
      );
    } else {
      // Check if timeframe interval has passed - update baseline
      const timeSinceLastUpdate = currentTime - existing.lastUpdateTime;

      if (timeSinceLastUpdate >= timeframeMs) {
        // Timeframe interval passed - update baseline to previous current
        existing.baseline = existing.current;
        existing.timestamp = existing.lastUpdateTime;
        console.log(
          `📊 Updated Open Interest baseline for ${symbol} (${timeframe}): New baseline=${existing.baseline.toLocaleString()}`
        );
      }

      // Update current OI
      existing.current = currentOI;
      existing.lastUpdateTime = currentTime;
    }

    return this.openInterestData.get(key);
  }

  async evaluateOpenInterestConditions(
    openInterestConditions,
    alert,
    priceData
  ) {
    const { direction, timeframes, percentage } = openInterestConditions;
    const requiredPercentage = parseFloat(percentage) || 0;

    console.log(
      `📊 Open Interest Evaluation: ${direction}${
        percentage ? ` by ${percentage}%` : ""
      } on timeframes: ${timeframes?.join(", ") || "N/A"}`
    );

    // If timeframes are specified, check ALL timeframes
    if (timeframes && timeframes.length > 0 && alert?.symbol) {
      let allTimeframesPassed = true;
      let verifiedTimeframes = 0;

      for (const timeframe of timeframes) {
        console.log(`   Checking timeframe: ${timeframe}`);

        // Get Open Interest data for this timeframe
        const oiData = await this.getOpenInterestData(
          alert.symbol,
          timeframe,
          alert
        );

        if (!oiData || oiData.current === null) {
          console.log(
            `   ⚠️ Timeframe ${timeframe}: Open Interest data not available, cannot verify`
          );
          allTimeframesPassed = false;
          break;
        }

        const currentOI = oiData.current;
        const baselineOI = oiData.baseline || currentOI;
        verifiedTimeframes++;

        const oiChange = ((currentOI - baselineOI) / baselineOI) * 100;

        console.log(
          `   Timeframe ${timeframe}: Current OI=${currentOI.toLocaleString()}, Baseline OI=${baselineOI.toLocaleString()}, Change=${oiChange.toFixed(
            2
          )}%`
        );

        let timeframePassed = false;

        switch (direction) {
          case "INCREASING":
            if (percentage) {
              timeframePassed = oiChange >= requiredPercentage;
              console.log(
                `   Timeframe ${timeframe}: Open Interest INCREASING check - Change ${oiChange.toFixed(
                  2
                )}% >= ${requiredPercentage}%? ${timeframePassed}`
              );
            } else {
              timeframePassed = oiChange > 0;
              console.log(
                `   Timeframe ${timeframe}: Open Interest INCREASING check - Change ${oiChange.toFixed(
                  2
                )}% > 0? ${timeframePassed}`
              );
            }
            break;

          case "DECREASING":
            if (percentage) {
              timeframePassed = oiChange <= -requiredPercentage;
              console.log(
                `   Timeframe ${timeframe}: Open Interest DECREASING check - Change ${oiChange.toFixed(
                  2
                )}% <= -${requiredPercentage}%? ${timeframePassed}`
              );
            } else {
              timeframePassed = oiChange < 0;
              console.log(
                `   Timeframe ${timeframe}: Open Interest DECREASING check - Change ${oiChange.toFixed(
                  2
                )}% < 0? ${timeframePassed}`
              );
            }
            break;

          case "ABOVE":
            if (percentage) {
              timeframePassed = oiChange >= requiredPercentage;
              console.log(
                `   Timeframe ${timeframe}: Open Interest ABOVE check - Change ${oiChange.toFixed(
                  2
                )}% >= ${requiredPercentage}%? ${timeframePassed}`
              );
            } else {
              timeframePassed = currentOI > baselineOI;
              console.log(
                `   Timeframe ${timeframe}: Open Interest ABOVE check - ${currentOI.toLocaleString()} > ${baselineOI.toLocaleString()}? ${timeframePassed}`
              );
            }
            break;

          case "BELOW":
            if (percentage) {
              timeframePassed = oiChange <= -requiredPercentage;
              console.log(
                `   Timeframe ${timeframe}: Open Interest BELOW check - Change ${oiChange.toFixed(
                  2
                )}% <= -${requiredPercentage}%? ${timeframePassed}`
              );
            } else {
              timeframePassed = currentOI < baselineOI;
              console.log(
                `   Timeframe ${timeframe}: Open Interest BELOW check - ${currentOI.toLocaleString()} < ${baselineOI.toLocaleString()}? ${timeframePassed}`
              );
            }
            break;

          default:
            console.log(`   Unknown Open Interest direction: ${direction}`);
            timeframePassed = false;
        }

        if (!timeframePassed) {
          allTimeframesPassed = false;
          console.log(
            `   ❌ Timeframe ${timeframe} FAILED: Open Interest condition ${direction} not met`
          );
          break; // One timeframe failed, condition invalid
        } else {
          console.log(
            `   ✅ Timeframe ${timeframe} PASSED: Open Interest condition ${direction} met`
          );
        }
      }

      console.log(
        `   Open Interest check (multi-timeframe): ${allTimeframesPassed} (${verifiedTimeframes}/${timeframes.length} timeframes verified, ALL must pass)`
      );
      return allTimeframesPassed;
    } else {
      // Fallback: use single Open Interest check if no timeframes specified
      let currentOpenInterest = priceData.openInterest || null;

      if (!currentOpenInterest) {
        currentOpenInterest = await this.fetchOpenInterest(alert?.symbol || "");
      }

      if (!currentOpenInterest) {
        console.log("⚠️ Open Interest data missing, skipping condition");
        return true;
      }

      const baselineOpenInterest =
        alert?.baselineOpenInterest || currentOpenInterest;
      const oiChange =
        ((currentOpenInterest - baselineOpenInterest) / baselineOpenInterest) *
        100;

      console.log(
        `   Current OI: ${currentOpenInterest.toLocaleString()}, Baseline OI: ${baselineOpenInterest.toLocaleString()}`
      );
      console.log(`   OI Change: ${oiChange.toFixed(2)}%`);

      switch (direction) {
        case "INCREASING":
          return percentage ? oiChange >= requiredPercentage : oiChange > 0;
        case "DECREASING":
          return percentage ? oiChange <= -requiredPercentage : oiChange < 0;
        case "ABOVE":
          return percentage
            ? oiChange >= requiredPercentage
            : currentOpenInterest > baselineOpenInterest;
        case "BELOW":
          return percentage
            ? oiChange <= -requiredPercentage
            : currentOpenInterest < baselineOpenInterest;
        default:
          return true;
      }
    }
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
    if (!timeframe) return 5 * 60 * 1000; // Default to 5 minutes

    // Normalize timeframe (uppercase for consistency)
    const normalized = timeframe.toUpperCase();

    const timeframes = {
      "1M": 1 * 60 * 1000, // 1 minute
      "1MIN": 1 * 60 * 1000, // 1 minute
      "2M": 2 * 60 * 1000, // 2 minutes
      "2MIN": 2 * 60 * 1000, // 2 minutes
      "3M": 3 * 60 * 1000, // 3 minutes
      "3MIN": 3 * 60 * 1000, // 3 minutes
      "5M": 5 * 60 * 1000, // 5 minutes
      "5MIN": 5 * 60 * 1000, // 5 minutes (uppercase format)
      "10M": 10 * 60 * 1000, // 10 minutes
      "10MIN": 10 * 60 * 1000, // 10 minutes
      "15M": 15 * 60 * 1000, // 15 minutes
      "15MIN": 15 * 60 * 1000, // 15 minutes
      "30M": 30 * 60 * 1000, // 30 minutes
      "30MIN": 30 * 60 * 1000, // 30 minutes
      "1H": 60 * 60 * 1000, // 1 hour
      "1HR": 60 * 60 * 1000, // 1 hour
      "2H": 2 * 60 * 60 * 1000, // 2 hours
      "2HR": 2 * 60 * 60 * 1000, // 2 hours
      "4H": 4 * 60 * 60 * 1000, // 4 hours
      "4HR": 4 * 60 * 60 * 1000, // 4 hours
      "6H": 6 * 60 * 60 * 1000, // 6 hours
      "6HR": 6 * 60 * 60 * 1000, // 6 hours
      "8H": 8 * 60 * 60 * 1000, // 8 hours
      "8HR": 8 * 60 * 60 * 1000, // 8 hours
      "12H": 12 * 60 * 60 * 1000, // 12 hours
      "12HR": 12 * 60 * 60 * 1000, // 12 hours
      "1D": 24 * 60 * 60 * 1000, // 1 day
      "1DAY": 24 * 60 * 60 * 1000, // 1 day
    };

    return timeframes[normalized] || timeframes["5MIN"]; // Default to 5 minutes
  }

  // Get Binance interval from our timeframe format
  getBinanceInterval(timeframe) {
    const tf = timeframe.toUpperCase();
    switch (tf) {
      case "1MIN":
      case "1M":
        return "1m";
      case "5MIN":
      case "5M":
        return "5m";
      case "15MIN":
      case "15M":
        return "15m";
      case "1HR":
      case "1H":
      case "1HOUR":
        return "1h";
      case "4HR":
      case "4H":
      case "4HOUR":
        return "4h";
      case "12HR":
      case "12H":
      case "12HOUR":
        return "12h";
      case "D":
      case "DAY":
      case "DAILY":
        return "1d";
      case "W":
      case "WEEK":
      case "WEEKLY":
        return "1w";
      case "M":
      case "MONTH":
      case "MONTHLY":
        return "1M";
      default:
        return "5m";
    }
  }

  // Fetch latest candle from Binance API for accurate OHLC data
  async fetchCandleFromBinance(symbol, timeframe) {
    try {
      const binanceInterval = this.getBinanceInterval(timeframe);
      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=1`
      );

      if (!response.ok) {
        console.warn(
          `⚠️ Failed to fetch candle from Binance for ${symbol} ${timeframe}: ${response.status}`
        );
        return null;
      }

      const klines = await response.json();
      if (klines && klines.length > 0) {
        const kline = klines[klines.length - 1]; // Get latest candle
        return {
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
          startTime: kline[0],
          endTime: kline[6],
          isComplete: true, // Binance returns completed candles
        };
      }
      return null;
    } catch (error) {
      console.warn(
        `⚠️ Error fetching candle from Binance for ${symbol} ${timeframe}:`,
        error.message
      );
      return null;
    }
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
  async updateCandleData(symbol, timeframe, priceData) {
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

      // Try to fetch the actual candle from Binance for accurate open price
      // This ensures we get the real open price when a new candle period starts
      const binanceCandle = await this.fetchCandleFromBinance(
        symbol,
        timeframe
      );

      if (binanceCandle && binanceCandle.startTime === candleStartTime) {
        // Use Binance candle data for accuracy
        candle.open = binanceCandle.open;
        candle.high = binanceCandle.high;
        candle.low = binanceCandle.low;
        candle.close = binanceCandle.close;
        candle.volume = binanceCandle.volume;
        candle.startTime = binanceCandle.startTime;
        candle.endTime = binanceCandle.endTime;
        candle.isComplete = binanceCandle.isComplete;
        console.log(
          `🕯️ New candle started for ${symbol} (${timeframe}) from Binance: Open=${candle.open}, Close=${candle.close}`
        );
      } else {
        // Fallback: use current price data if Binance fetch fails
        candle.open = parseFloat(priceData.price);
        candle.high = parseFloat(priceData.price);
        candle.low = parseFloat(priceData.price);
        candle.close = parseFloat(priceData.price);
        candle.volume = parseFloat(priceData.volume) || 0;
        candle.startTime = candleStartTime;
        candle.endTime = candleStartTime + timeframeMs;
        candle.isComplete = false;
        console.log(
          `🕯️ New candle started for ${symbol} (${timeframe}): Open=${candle.open} (using live price)`
        );
      }
    } else {
      // Update existing candle
      const price = parseFloat(priceData.price);
      candle.high = Math.max(candle.high || price, price);
      candle.low = Math.min(candle.low || price, price);
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
  checkCandleChangeCondition(symbol, timeframe, requiredChange, baselinePrice) {
    const candle = this.getCandleData(symbol, timeframe);

    console.log(`🔍 Checking candle for ${symbol} (${timeframe}):`);
    console.log(`   Candle complete: ${candle.isComplete}`);
    console.log(`   Open: ${candle.open}, Close: ${candle.close}`);
    console.log(`   Baseline Price: ${baselinePrice}`);
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

    // Calculate change from baseline price instead of candle open
    const currentPrice = candle.close;
    const changeFromBaseline =
      ((currentPrice - baselinePrice) / baselinePrice) * 100;
    const absoluteChange = Math.abs(changeFromBaseline);

    console.log(`📊 Candle Change Check for ${symbol} (${timeframe}):`);
    console.log(`   Baseline: ${baselinePrice}, Current: ${currentPrice}`);
    console.log(
      `   Change from Baseline: ${changeFromBaseline.toFixed(
        3
      )}%, Required: ${requiredChange}%`
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
