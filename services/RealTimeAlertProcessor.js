import { AlertsCache, FavoritesCache } from "../utils/redis.js";
import { isAlertLocked, updateAlertLock } from "../utils/alertLock.js";
import AlertHistoryService from "./AlertHistoryService.js";
import NotificationService from "./NotificationService.js";
import EmailService from "./EmailService.js";
import TelegramService from "./TelegramService.js";
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
    this.currentRound = 0; // Track current processing round
    this.isRoundProcessing = false; // Prevent overlapping rounds
    this.roundInterval = null; // Round processing interval
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
        return;
      }

      // Step 2: Get current live prices for all symbols
      const livePrices = await this.getCurrentLivePrices();
      console.log(
        `📡 Round ${this.currentRound}: Fetched live prices for ${
          Object.keys(livePrices).length
        } symbols`
      );

      // Step 3: Process each alert with live data
      let processedCount = 0;
      let triggeredCount = 0;

      for (const alert of freshAlerts) {
        const liveData = livePrices[alert.symbol];
        if (liveData) {
          const result = await this.processAlertWithLiveData(alert, liveData);
          processedCount++;
          if (result.triggered) {
            triggeredCount++;
          }
        }
      }

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

        // Simple candle check based on current price vs open
        if (candleCondition === "CANDLE_ABOVE_OPEN") {
          if (
            liveData.close &&
            liveData.open &&
            liveData.close > liveData.open
          ) {
            console.log(
              `✅ Candle condition PASSED: Close (${liveData.close}) > Open (${liveData.open})`
            );
          } else {
            console.log(`❌ Candle condition FAILED: Close not above Open`);
            conditionsMet = false;
          }
        } else if (candleCondition === "BULLISH") {
          // Bullish: close > open
          if (
            liveData.close &&
            liveData.open &&
            liveData.close > liveData.open
          ) {
            console.log(`✅ Bullish candle condition PASSED`);
          } else {
            console.log(`❌ Bullish candle condition FAILED`);
            conditionsMet = false;
          }
        } else if (candleCondition === "BEARISH") {
          // Bearish: close < open
          if (
            liveData.close &&
            liveData.open &&
            liveData.close < liveData.open
          ) {
            console.log(`✅ Bearish candle condition PASSED`);
          } else {
            console.log(`❌ Bearish candle condition FAILED`);
            conditionsMet = false;
          }
        }
      }

      // Check RSI Range conditions (optional)
      if (
        conditionsMet &&
        conditions.rsiRange &&
        conditions.rsiRange.timeframes &&
        conditions.rsiRange.timeframes.length > 0
      ) {
        const rsiLevel = parseFloat(conditions.rsiRange.level || "70");
        const rsiCondition = conditions.rsiRange.condition || "ABOVE";
        const rsiPeriod = parseInt(conditions.rsiRange.period || "14");

        console.log(
          `📊 Checking RSI condition: ${rsiCondition} ${rsiLevel} on timeframes: ${conditions.rsiRange.timeframes.join(
            ", "
          )}`
        );

        // Simplified RSI estimation based on price change
        // Real implementation would require historical data
        const priceChangePercent = Math.abs(
          parseFloat(liveData.priceChangePercent || 0)
        );
        const estimatedRSI = 50 + priceChangePercent * 2; // Very simplified estimation

        console.log(
          `📊 Estimated RSI: ${estimatedRSI.toFixed(
            2
          )} (based on ${priceChangePercent}% change)`
        );

        if (rsiCondition === "ABOVE" && estimatedRSI > rsiLevel) {
          console.log(
            `✅ RSI condition PASSED: ${estimatedRSI.toFixed(2)} > ${rsiLevel}`
          );
        } else if (rsiCondition === "BELOW" && estimatedRSI < rsiLevel) {
          console.log(
            `✅ RSI condition PASSED: ${estimatedRSI.toFixed(2)} < ${rsiLevel}`
          );
        } else {
          console.log(`❌ RSI condition FAILED`);
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
        const volumeCondition = conditions.volume.condition || "INCREASING";
        const volumePercentage = parseFloat(
          conditions.volume.percentage || "20"
        );

        console.log(
          `📈 Checking Volume condition: ${volumeCondition} by ${volumePercentage}% on timeframes: ${conditions.volume.timeframes.join(
            ", "
          )}`
        );

        // Compare current volume with baseline volume
        const currentVolume = parseFloat(
          liveData.volume || liveData.volume24h || 0
        );
        const baselineVolume = parseFloat(alert.baselineVolume || 0);

        if (baselineVolume > 0) {
          const volumeChange =
            ((currentVolume - baselineVolume) / baselineVolume) * 100;

          console.log(
            `📈 Volume change: ${volumeChange.toFixed(
              2
            )}% (Current: ${currentVolume}, Baseline: ${baselineVolume})`
          );

          if (
            volumeCondition === "INCREASING" &&
            volumeChange >= volumePercentage
          ) {
            console.log(
              `✅ Volume INCREASING condition PASSED: ${volumeChange.toFixed(
                2
              )}% >= ${volumePercentage}%`
            );
          } else if (
            volumeCondition === "DECREASING" &&
            volumeChange <= -volumePercentage
          ) {
            console.log(
              `✅ Volume DECREASING condition PASSED: ${volumeChange.toFixed(
                2
              )}% <= -${volumePercentage}%`
            );
          } else {
            console.log(`❌ Volume condition FAILED`);
            conditionsMet = false;
          }
        } else {
          console.log(
            `⚠️ No baseline volume available, skipping volume condition`
          );
        }
      }

      // Check EMA conditions (optional)
      if (
        conditionsMet &&
        conditions.ema &&
        conditions.ema.timeframes &&
        conditions.ema.timeframes.length > 0
      ) {
        const fastEMA = parseInt(conditions.ema.fast || "12");
        const slowEMA = parseInt(conditions.ema.slow || "26");
        const emaCondition = conditions.ema.condition || "ABOVE";

        console.log(
          `📉 Checking EMA condition: Fast(${fastEMA}) ${emaCondition} Slow(${slowEMA}) on timeframes: ${conditions.ema.timeframes.join(
            ", "
          )}`
        );

        // Simplified EMA check using price momentum
        // Real implementation would require historical price data for EMA calculation
        const priceChange = parseFloat(liveData.priceChangePercent || 0);

        // If price is trending up, assume fast EMA > slow EMA
        // If price is trending down, assume fast EMA < slow EMA
        const isFastAboveSlow = priceChange > 0;

        if (emaCondition === "ABOVE" && isFastAboveSlow) {
          console.log(
            `✅ EMA condition PASSED: Fast EMA appears to be ABOVE Slow EMA (positive momentum)`
          );
        } else if (emaCondition === "BELOW" && !isFastAboveSlow) {
          console.log(
            `✅ EMA condition PASSED: Fast EMA appears to be BELOW Slow EMA (negative momentum)`
          );
        } else {
          console.log(`❌ EMA condition FAILED`);
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
      console.log(`🔍 Debug - Live Data for ${alert.symbol}:`, {
        price: liveData.price,
        volume: liveData.volume,
        volume24h: liveData.volume24h,
        priceChange: liveData.priceChange,
        priceChangePercent: liveData.priceChangePercent,
        high: liveData.high,
        low: liveData.low,
        open: liveData.open,
        close: liveData.close,
        timestamp: liveData.timestamp,
      });

      console.log(`🔍 Debug - Alert Data for ${alert.symbol}:`, {
        baselinePrice: baselinePrice,
        baselineVolume: baselineVolume,
        baselineTimestamp: baselineTimestamp,
        changeFromBaseline: changeFromBaseline,
        changeFromBaselinePercent: changeFromBaselinePercent,
      });

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

      console.log(
        `🔍 Debug - Alert History Data:`,
        JSON.stringify(alertHistory, null, 2)
      );

      // Save to AlertHistory
      console.log(`📝 Saving alert history for ${alert.symbol}...`);
      await AlertHistoryService.createAlertHistory(alertHistory);

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

      // Send real-time notification
      await this.sendRealTimeNotification(alert, liveData, alertHistory);

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
        `📊 Live data: Price=${priceData.price}, Volume=${priceData.volume24h}, Change=${priceData.priceChangePercent}%`
      );
      console.log(
        `📊 Baseline: Price=${alert.baselinePrice}, Volume=${alert.baselineVolume}, Timestamp=${alert.baselineTimestamp}`
      );

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
      try {
        const savedHistory = await AlertHistoryService.createAlertHistory(
          alertHistory
        );
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
      if (
        alert.conditions.alertCount &&
        alert.conditions.alertCount.timeframe
      ) {
        const updatedConditions = updateAlertLock(alert);

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

      // Clean up old processed alerts (keep only last 60 seconds)
      const currentTime = Math.floor(Date.now() / 1000);
      for (const key of this.processedAlerts) {
        const [, timestamp] = key.split("_");
        if (timestamp && currentTime - parseInt(timestamp) > 60) {
          this.processedAlerts.delete(key);
        }
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
      // Get user info for email and telegram
      const user = await User.findById(alert.userId).select('email telegramChatId notificationPreferences').lean();
      
      if (!user) {
        console.error(`❌ User not found: ${alert.userId}`);
        return;
      }

      // Prepare notification data for web socket
      const notification = {
        type: "alert_triggered",
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
        // Add detailed alert info for frontend
        targetValue: alert.alertConditions?.changePercent?.percentage,
        actualValue: priceData.priceChangePercent,
        direction: alert.alertConditions?.changePercent?.direction === 'increase' ? 'Increase' : 'Decrease',
        timeframe: alert.alertConditions?.changePercent?.timeframe || '5MIN',
        baselinePrice: alertHistory.baselineData?.baselinePrice,
        changeFromBaselinePercent: alertHistory.baselineData?.changeFromBaselinePercent,
      };

      // Send web socket notification
      await NotificationService.sendNotification(alert.userId, notification);

      // Prepare formatted alert data for Email & Telegram
      const alertData = {
        symbol: alert.symbol,
        targetValue: alert.alertConditions?.changePercent?.percentage,
        actualValue: priceData.priceChangePercent,
        direction: alert.alertConditions?.changePercent?.direction === 'increase' ? 'Increase' : 'Decrease',
        timeframe: alert.alertConditions?.changePercent?.timeframe || '5MIN',
        triggeredPrice: priceData.price,
        baselinePrice: alertHistory.baselineData?.baselinePrice,
        changeFromBaselinePercent: alertHistory.baselineData?.changeFromBaselinePercent,
        volume: priceData.volume || priceData.volume24h,
        triggeredAt: alertHistory.triggeredAt,
      };

      // Send Email notification if enabled
      if (user.notificationPreferences?.email !== false && user.email) {
        console.log(`📧 Sending email to ${user.email}...`);
        const emailSent = await EmailService.sendAlertEmail(user.email, alertData);
        if (emailSent) {
          console.log(`✅ Email sent successfully to ${user.email}`);
        } else {
          console.error(`❌ Failed to send email to ${user.email}`);
        }
      }

      // Send Telegram notification if enabled
      if (user.notificationPreferences?.telegram && user.telegramChatId) {
        console.log(`📱 Sending Telegram message to ${user.telegramChatId}...`);
        const telegramSent = await TelegramService.sendAlertMessage(user.telegramChatId, alertData);
        if (telegramSent) {
          console.log(`✅ Telegram message sent successfully`);
        } else {
          console.error(`❌ Failed to send Telegram message`);
        }
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

  // Technical analysis helper methods
  evaluateCandleConditions(candleConditions, priceData) {
    const { open, high, low, close } = priceData;

    // Validate OHLC data
    if (!open || !high || !low || !close) {
      console.log("⚠️ Missing OHLC data for candle evaluation");
      return true; // Skip if data missing
    }

    const condition = candleConditions.condition;
    const body = Math.abs(close - open);
    const range = high - low;
    const upperWick = high - Math.max(close, open);
    const lowerWick = Math.min(close, open) - low;

    console.log(`🕯️ Candle Evaluation: ${condition}`);
    console.log(`   OHLC: O=${open}, H=${high}, L=${low}, C=${close}`);
    console.log(`   Body=${body.toFixed(6)}, Range=${range.toFixed(6)}`);

    switch (condition) {
      case "CANDLE_ABOVE_OPEN":
      case "BULLISH":
        // Bullish candle: Close > Open
        const isBullish = close > open;
        console.log(
          `   Bullish check: ${isBullish} (Close ${close} > Open ${open})`
        );
        return isBullish;

      case "CANDLE_BELOW_OPEN":
      case "BEARISH":
        // Bearish candle: Close < Open
        const isBearish = close < open;
        console.log(
          `   Bearish check: ${isBearish} (Close ${close} < Open ${open})`
        );
        return isBearish;

      case "DOJI":
        // Doji: Very small body (< 0.1% of range)
        const isDoji = body < range * 0.001;
        console.log(
          `   Doji check: ${isDoji} (Body ${body.toFixed(6)} < ${(
            range * 0.001
          ).toFixed(6)})`
        );
        return isDoji;

      case "HAMMER":
        // Hammer: Small upper wick, long lower wick, small body at top
        const isHammer =
          close > open && // Bullish
          lowerWick > body * 2 && // Long lower wick
          upperWick < body * 0.5; // Small upper wick
        console.log(`   Hammer check: ${isHammer}`);
        return isHammer;

      case "SHOOTING_STAR":
        // Shooting Star: Long upper wick, small body at bottom
        const isShootingStar =
          close < open && // Bearish
          upperWick > body * 2 && // Long upper wick
          lowerWick < body * 0.5; // Small lower wick
        console.log(`   Shooting Star check: ${isShootingStar}`);
        return isShootingStar;

      case "ENGULFING_BULLISH":
        // Need previous candle data - skip for now
        console.log(`   Engulfing patterns need historical data - skipping`);
        return true;

      default:
        console.log(`   Unknown candle condition: ${condition}`);
        return true;
    }
  }

  evaluateRSIConditions(rsiConditions, priceData) {
    const { condition, level } = rsiConditions;
    const targetLevel = parseFloat(level) || 50;

    // Estimate RSI based on 24h price change
    // This is a simplified approximation - real RSI needs 14 periods of data
    const priceChangePercent = parseFloat(priceData.priceChangePercent) || 0;

    // Map price change to RSI estimate:
    // -10% or less -> RSI ~30 (oversold)
    // 0% -> RSI ~50 (neutral)
    // +10% or more -> RSI ~70 (overbought)
    let estimatedRSI = 50 + priceChangePercent * 2;
    estimatedRSI = Math.max(0, Math.min(100, estimatedRSI)); // Clamp between 0-100

    console.log(`📈 RSI Evaluation: ${condition} ${targetLevel}`);
    console.log(`   Price Change: ${priceChangePercent}%`);
    console.log(`   Estimated RSI: ${estimatedRSI.toFixed(2)}`);

    switch (condition) {
      case "ABOVE":
        const isAbove = estimatedRSI > targetLevel;
        console.log(
          `   Check: RSI ${estimatedRSI.toFixed(
            2
          )} > ${targetLevel}? ${isAbove}`
        );
        return isAbove;

      case "BELOW":
        const isBelow = estimatedRSI < targetLevel;
        console.log(
          `   Check: RSI ${estimatedRSI.toFixed(
            2
          )} < ${targetLevel}? ${isBelow}`
        );
        return isBelow;

      case "OVERBOUGHT":
        // RSI > 70 is typically overbought
        const isOverbought = estimatedRSI > 70;
        console.log(
          `   Overbought check: RSI ${estimatedRSI.toFixed(
            2
          )} > 70? ${isOverbought}`
        );
        return isOverbought;

      case "OVERSOLD":
        // RSI < 30 is typically oversold
        const isOversold = estimatedRSI < 30;
        console.log(
          `   Oversold check: RSI ${estimatedRSI.toFixed(
            2
          )} < 30? ${isOversold}`
        );
        return isOversold;

      default:
        console.log(`   Unknown RSI condition: ${condition}`);
        return true;
    }
  }

  evaluateVolumeConditions(volumeConditions, priceData) {
    const { condition, percentage } = volumeConditions;
    const currentVolume =
      parseFloat(priceData.volume || priceData.volume24h) || 0;

    if (currentVolume === 0) {
      console.log("⚠️ Volume data missing, skipping volume condition");
      return true;
    }

    console.log(`📉 Volume Evaluation: ${condition}`);
    console.log(`   Current Volume: ${currentVolume.toLocaleString()}`);

    // For INCREASING/DECREASING, we need historical volume data
    // As a workaround, we'll use the alert's baseline volume if available
    const baselineVolume = this.alertBaselines.get(
      `volume_${priceData.symbol}`
    );

    switch (condition) {
      case "INCREASING":
        if (baselineVolume && baselineVolume > 0) {
          const volumeChange =
            ((currentVolume - baselineVolume) / baselineVolume) * 100;
          const isIncreasing = volumeChange > 5; // 5% increase threshold
          console.log(`   Baseline Volume: ${baselineVolume.toLocaleString()}`);
          console.log(`   Volume Change: ${volumeChange.toFixed(2)}%`);
          console.log(`   Increasing check: ${isIncreasing} (change > 5%)`);
          return isIncreasing;
        }
        // If no baseline, assume true
        console.log(`   No baseline volume, assuming INCREASING`);
        return true;

      case "DECREASING":
        if (baselineVolume && baselineVolume > 0) {
          const volumeChange =
            ((currentVolume - baselineVolume) / baselineVolume) * 100;
          const isDecreasing = volumeChange < -5; // 5% decrease threshold
          console.log(`   Baseline Volume: ${baselineVolume.toLocaleString()}`);
          console.log(`   Volume Change: ${volumeChange.toFixed(2)}%`);
          console.log(`   Decreasing check: ${isDecreasing} (change < -5%)`);
          return isDecreasing;
        }
        // If no baseline, assume true
        console.log(`   No baseline volume, assuming DECREASING`);
        return true;

      case "ABOVE_AVERAGE":
        // Use a simple heuristic: if volume is significantly higher than typical
        // We'll use 150% of baseline as "above average"
        if (baselineVolume && baselineVolume > 0) {
          const isAboveAverage = currentVolume > baselineVolume * 1.5;
          console.log(`   Baseline Volume: ${baselineVolume.toLocaleString()}`);
          console.log(
            `   Above Average check: ${isAboveAverage} (${currentVolume} > ${
              baselineVolume * 1.5
            })`
          );
          return isAboveAverage;
        }
        return true;

      case "SPIKE":
        // Volume spike: 200% or more of baseline
        if (baselineVolume && baselineVolume > 0) {
          const isSpike = currentVolume > baselineVolume * 2;
          console.log(`   Baseline Volume: ${baselineVolume.toLocaleString()}`);
          console.log(
            `   Spike check: ${isSpike} (${currentVolume} > ${
              baselineVolume * 2
            })`
          );
          return isSpike;
        }
        return true;

      case "PERCENTAGE":
        // Custom percentage change
        if (percentage && baselineVolume && baselineVolume > 0) {
          const targetPercentage = parseFloat(percentage);
          const volumeChange =
            ((currentVolume - baselineVolume) / baselineVolume) * 100;
          const meetsPercentage = volumeChange >= targetPercentage;
          console.log(`   Target: ${targetPercentage}% change`);
          console.log(`   Actual: ${volumeChange.toFixed(2)}% change`);
          console.log(`   Percentage check: ${meetsPercentage}`);
          return meetsPercentage;
        }
        return true;

      default:
        console.log(`   Unknown volume condition: ${condition}`);
        return true;
    }
  }

  evaluateEMAConditions(emaConditions, priceData) {
    const { condition, fast, slow } = emaConditions;
    const currentPrice = parseFloat(priceData.close || priceData.price) || 0;
    const priceChangePercent = parseFloat(priceData.priceChangePercent) || 0;

    if (currentPrice === 0) {
      console.log("⚠️ Price data missing, skipping EMA condition");
      return true;
    }

    const fastPeriod = parseInt(fast) || 12;
    const slowPeriod = parseInt(slow) || 26;

    console.log(`📊 EMA Evaluation: ${condition}`);
    console.log(`   Fast EMA: ${fastPeriod}, Slow EMA: ${slowPeriod}`);
    console.log(`   Current Price: ${currentPrice}`);
    console.log(`   Price Change: ${priceChangePercent}%`);

    // Simplified EMA estimation based on price trends
    // In a real implementation, you'd calculate actual EMAs from historical data
    // Here we use price change as a proxy for EMA positioning

    // Estimate: If price is rising, fast EMA is likely above slow EMA
    // If price is falling, fast EMA is likely below slow EMA
    const estimatedFastEMA =
      currentPrice * (1 + (priceChangePercent / 100) * 0.7);
    const estimatedSlowEMA =
      currentPrice * (1 + (priceChangePercent / 100) * 0.3);

    console.log(
      `   Estimated Fast EMA (${fastPeriod}): ${estimatedFastEMA.toFixed(6)}`
    );
    console.log(
      `   Estimated Slow EMA (${slowPeriod}): ${estimatedSlowEMA.toFixed(6)}`
    );

    switch (condition) {
      case "ABOVE":
      case "BULLISH_CROSSOVER":
        // Fast EMA above Slow EMA (bullish)
        const isBullish = estimatedFastEMA > estimatedSlowEMA;
        console.log(
          `   Bullish check: Fast EMA ${estimatedFastEMA.toFixed(
            6
          )} > Slow EMA ${estimatedSlowEMA.toFixed(6)}? ${isBullish}`
        );
        return isBullish;

      case "BELOW":
      case "BEARISH_CROSSOVER":
        // Fast EMA below Slow EMA (bearish)
        const isBearish = estimatedFastEMA < estimatedSlowEMA;
        console.log(
          `   Bearish check: Fast EMA ${estimatedFastEMA.toFixed(
            6
          )} < Slow EMA ${estimatedSlowEMA.toFixed(6)}? ${isBearish}`
        );
        return isBearish;

      case "PRICE_ABOVE_EMA":
        // Price above both EMAs
        const priceAbove = currentPrice > estimatedSlowEMA;
        console.log(
          `   Price Above EMA check: ${currentPrice} > ${estimatedSlowEMA}? ${priceAbove}`
        );
        return priceAbove;

      case "PRICE_BELOW_EMA":
        // Price below both EMAs
        const priceBelow = currentPrice < estimatedSlowEMA;
        console.log(
          `   Price Below EMA check: ${currentPrice} < ${estimatedSlowEMA}? ${priceBelow}`
        );
        return priceBelow;

      case "CONVERGING":
        // EMAs are getting closer (difference < 1%)
        const difference = Math.abs(estimatedFastEMA - estimatedSlowEMA);
        const percentDiff = (difference / estimatedSlowEMA) * 100;
        const isConverging = percentDiff < 1;
        console.log(
          `   Converging check: ${percentDiff.toFixed(
            2
          )}% difference < 1%? ${isConverging}`
        );
        return isConverging;

      case "DIVERGING":
        // EMAs are moving apart (difference > 2%)
        const diff = Math.abs(estimatedFastEMA - estimatedSlowEMA);
        const pctDiff = (diff / estimatedSlowEMA) * 100;
        const isDiverging = pctDiff > 2;
        console.log(
          `   Diverging check: ${pctDiff.toFixed(
            2
          )}% difference > 2%? ${isDiverging}`
        );
        return isDiverging;

      default:
        console.log(`   Unknown EMA condition: ${condition}`);
        return true;
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
